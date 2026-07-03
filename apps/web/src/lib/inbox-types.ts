export type InboxThreadSummary = {
  threadKey: string;
  subject: string | null;
  mailboxId: string;
  mailboxAddress: string;
  prospectEmail: string | null;
  prospectName: string | null;
  enrollmentId: string | null;
  sequenceId: string | null;
  sequenceName: string | null;
  lastMessageAt: string;
  lastDirection: "inbound" | "outbound";
  unreadCount: number;
  hasBounce: boolean;
  preview: string | null;
  sentiment: string | null;
};
