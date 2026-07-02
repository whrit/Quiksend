declare module "imapflow" {
  export class ImapFlow {
    constructor(options: {
      host: string;
      port: number;
      secure?: boolean;
      auth: { user: string; pass: string };
      logger?: boolean;
    });
    connect(): Promise<void>;
    logout(): Promise<void>;
    getMailboxLock(path: string): Promise<{ release(): void }>;
    search(query: { since?: Date }, options?: { uid?: boolean }): Promise<number[] | false>;
    fetchOne(
      seq: string,
      query: { source?: boolean; uid?: boolean },
      options?: { uid?: boolean },
    ): Promise<{ source?: Buffer; uid?: number } | false>;
  }
}
