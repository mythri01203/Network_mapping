// The parts of net-snmp 3.29.2 the DASAN poller uses (the package ships no types).
declare module 'net-snmp' {
  export interface Varbind {
    oid: string;
    type: number;
    value: number | Buffer | string | null;
  }
  export interface Session {
    subtree(
      oid: string,
      maxRepetitions: number,
      feed: (varbinds: Varbind[]) => boolean | void,
      done: (error?: Error) => void,
    ): void;
    close(): void;
    on(event: 'error', listener: (error: Error) => void): void;
  }
  export const Version1: number;
  export const Version2c: number;
  export function createSession(
    target: string,
    community: string,
    options?: { port?: number; version?: number; timeout?: number; retries?: number },
  ): Session;
  export function isVarbindError(varbind: Varbind): boolean;
  const snmp: {
    Version1: number;
    Version2c: number;
    createSession: typeof createSession;
    isVarbindError: typeof isVarbindError;
  };
  export default snmp;
}
