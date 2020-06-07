import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import Democracy, { Node } from 'democracy';
import { Advertisement, Browser, Service, udp } from 'dnssd2';
import _ from 'lodash';
import * as os from 'os';
import { NetworkInterfaceInfo } from 'os';
import { ConfigService } from '../config/config.service';
import { ClusterConfig } from './cluster.config';
import { makeId } from '../util/id';

@Injectable()
export class ClusterService extends Democracy
  implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly configService: ConfigService;
  private readonly config: ClusterConfig;
  private readonly logger: Logger;

  private advertisement: Advertisement;
  private browser: Browser;
  private networkInterfaces: NetworkInterfaceInfo[];

  constructor(configService: ConfigService) {
    const config = configService.get('cluster');
    const globalConfig = configService.get('global');

    const networkInterfaces = _.flatMap<NetworkInterfaceInfo>(
      config.networkInterface
        ? os.networkInterfaces()[config.networkInterface]
        : os.networkInterfaces()
    );
    const ip = networkInterfaces.find(
      (address) => address.internal === false && address.family === 'IPv4'
    ).address;
    super({
      id: makeId(globalConfig.instanceName),
      source: `${ip}:${config.port}`,
      peers: Array.from(config.peerAddresses),
      timeout: config.timeout * 1000,
      weight: config.weight,
    });

    this.networkInterfaces = networkInterfaces;
    this.configService = configService;
    this.config = config;
    this.logger = new Logger(ClusterService.name);
  }

  /**
   * Lifecycle hook, called once the host module has been initialized.
   */
  onModuleInit(): void {
    this.on('added', this.handleNodeAdded);
    this.on('removed', this.handleNodeRemoved);
    this.on('elected', this.handleNodeElected);
    this.on('leader', this.handleNodeElected);
    this.on('peers', this.addMissingPeers);
  }

  /**
   * Lifecycle hook, called once the application has started.
   */
  onApplicationBootstrap(): void {
    if (this.config.autoDiscovery) {
      try {
        this.startBonjourDiscovery();
      } catch (e) {
        this.logger.error(
          `Failed to start mdns discovery (${e.message}). Automatic discovery may not function. You may need to provide the addresses of other room-assistant nodes manually in the config.`,
          e.stack
        );
      }
    }

    this.broadcastPeers();
  }

  /**
   * Lifecycle hook, called once the application is shutting down.
   */
  onApplicationShutdown(): void {
    this.advertisement?.stop();
    this.browser?.stop();
  }

  /**
   * Checks if this instance leads a majority of the cluster.
   *
   * @returns Majority leader or not
   */
  isMajorityLeader(): boolean {
    return this.isLeader() && this.quorumReached();
  }

  /**
   * Checks if number of active nodes in the cluster is at least the size of quorum (if configured).
   *
   * @returns Quorum size reached or not
   */
  quorumReached(): boolean {
    const activeNodes = Object.values(this.nodes()).filter(
      (node) => node.state !== 'removed'
    );
    return !this.config.quorum || activeNodes.length >= this.config.quorum;
  }

  /**
   * Broadcasts a message with all peers that we are connected to locally.
   */
  broadcastPeers(): void {
    if (this.options?.peers) {
      this.send('peers', this.options.peers);
    }
  }

  /**
   * Adds previously unknown endpoints from a list to our connections.
   *
   * @param peers - Array of endpoints in the format [[ip, port], ...]
   */
  protected addMissingPeers(peers: string[][]): void {
    peers.forEach((peer) => {
      const index = this.options.peers.findIndex(
        (p) => p[0] === peer[0] && p[1] === peer[1]
      );

      if (index < 0) {
        this.options.peers.push(peer);
      }
    });
  }

  /**
   * Check if a node should be removed from the cluster.
   *
   * @param candidate - Node ID of the removal candidate
   * @returns this
   */
  protected checkBallots(candidate: string): this {
    super.checkBallots(candidate);

    // if the peer address was configured manually it should not be removed completely
    const node = this._nodes[candidate];
    if (this.config.peerAddresses.includes(node.source)) {
      this.logger.debug(
        `Saving configured peer ${node.source} from ultimate removal`
      );
      clearTimeout(node.disconnected);
      delete node.disconnected;
    }

    return this;
  }

  /**
   * Starts advertising and browsing for room-assistant services using MDNS.
   */
  protected startBonjourDiscovery(): void {
    this.logger.log('Starting mDNS advertisements and discovery');
    this.advertisement = new Advertisement(
      udp('_room-assistant'),
      this.config.port,
      { interface: this.config.networkInterface }
    )
      .on('error', (e) => {
        this.logger.error(e.message, e.trace);
      })
      .start();

    this.browser = new Browser(udp('_room-assistant'))
      .on('serviceUp', this.handleNodeDiscovery.bind(this))
      .on('error', (e) => {
        this.logger.error(e.message, e.trace);
      })
      .start();
  }

  /**
   * Handles a discovered room-assistant MDNS service.
   *
   * @param service - Discovered MDNS service
   */
  private handleNodeDiscovery(service: Service): void {
    const ownIps = this.networkInterfaces.map((info) => info.address);
    if (
      _.some(service.addresses, (address) => ownIps.includes(address)) ||
      _.some(this.options.peers, (peer) =>
        service.addresses.some(
          (address) =>
            peer[0] === address && peer[1] === service.port.toString()
        )
      )
    ) {
      return;
    }

    this.options.peers.push([service.addresses[0], service.port.toString()]);
    this.send('hello');
  }

  /**
   * Handles a node added to the cluster.
   *
   * @param node - Node that was added
   */
  private handleNodeAdded(node: Node): void {
    this.logger.log(`Added ${node.source} to the cluster with id ${node.id}`);
    this.broadcastPeers();
  }

  /**
   * Handles a node that was removed from the cluster.
   *
   * @param node - Node that was removed
   */
  private handleNodeRemoved(node: Node): void {
    this.logger.log(
      `Removed ${node.source} from the cluster with id ${node.id}`
    );
  }

  /**
   * Handles a node that was elected as leader.
   *
   * @param node - Node that was elected
   */
  private handleNodeElected(node: Node): void {
    this.logger.log(`${node.id} has been elected as leader`);
  }
}
