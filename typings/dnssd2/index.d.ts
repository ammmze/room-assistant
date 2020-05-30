declare module 'dnssd2' {
    import { EventEmitter } from 'events';

    export class Advertisement extends EventEmitter {
        constructor(serviceType: ServiceType, port: number, options?: AdvertisementOptions);
        start(): this;
        stop(forceImmediately?: boolean, callback?: () => void): void;
        updateTXT(txt: Txt): void;
    }

    export class Browser extends EventEmitter {
        constructor(serviceType: ServiceType, options?: BrowserOptions);
        start(): this;
        stop(): void;
        list(): Service[]
    }

    export class ServiceType {
        constructor(args: ServiceTypeDetails | string | [string, string, string | string[]]);
        constructor(...args: string[])
    }

    export function tcp(serviceName: string, ...subtypes: string[]): ServiceType;
    export function tcp(serviceNameAndSubtypes: string[]): ServiceType;
    export function udp(serviceName: string, ...subtypes: string[]): ServiceType;
    export function udp(serviceNameAndSubtypes: string[]): ServiceType;
    export function all(): ServiceType;

    type Service = {
        fullname: string;
        name: string;
        type: ServiceTypeDetails;
        domain: string;
        host: string;
        port: number;
        addresses: string[];
        txt: any;
        txtRaw: any;
    }

    type Txt = {
        [key: string]: string | number | boolean | Buffer;
    }

    type AdvertisementOptions = {
        name?: string;
        host?: string;
        txt?: Txt;
        subtypes?: string[];
        interface?: string;
    }

    type BrowserOptions = {

    }

    type ServiceTypeDetails = {
        name: string;
        protocol: string;
        subtypes?: string[]
    }
}