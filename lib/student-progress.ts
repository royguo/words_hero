import {
  advanceGame,
  replayActions,
  MAX_BATCH_ACTIONS,
  type GameAction,
  type StudentSession,
} from './student-game';

export type StageCheckpoint = {
  revision: number;
  request_id: string;
  actions: GameAction[];
};
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Draft = StageCheckpoint & { schema_version: 1; session_id: string };
const cacheKey = (studentId: string) => 'kite.student.progress.v1:' + studentId;

/** Only unacknowledged actions live in browser storage; no passwords or profile data. */
export class StudentProgress {
  session: StudentSession;
  pending: StageCheckpoint | null = null;
  storageAvailable = true;
  private baseStage: StudentSession['game']['stage'];
  constructor(
    private studentId: string,
    server: StudentSession,
    private storage: () => Storage = () => localStorage,
  ) {
    this.session = server;
    this.baseStage = server.game.stage;
    try {
      const raw = this.storage().getItem(cacheKey(studentId));
      if (!raw) return;
      const draft: Draft = JSON.parse(raw);
      if (
        draft.schema_version === 1 &&
        draft.session_id === server.id &&
        draft.revision === server.revision &&
        typeof draft.request_id === 'string' &&
        /^[a-zA-Z0-9_-]{12,80}$/.test(draft.request_id)
      ) {
        this.session = {
          ...server,
          game: replayActions(server.game, draft.actions),
        };
        this.pending = {
          revision: draft.revision,
          request_id: draft.request_id,
          actions: draft.actions,
        };
      } else this.storage().removeItem(cacheKey(studentId));
    } catch {
      // An invalid draft cannot replace authoritative progress; unavailable storage
      // must not turn each answer back into a blocking network request.
      this.storageAvailable = false;
    }
  }
  choose(action: GameAction) {
    const game = advanceGame(this.session.game, action);
    this.pending = {
      revision: this.session.revision,
      request_id: crypto.randomUUID(),
      actions: [...(this.pending?.actions || []), action],
    };
    this.session = { ...this.session, game };
    this.persist(); // Before animation, so a refresh during feedback keeps the answer.
    return this.session;
  }
  get needsCheckpoint() {
    return (
      !!this.pending &&
      (this.session.game.stage !== this.baseStage ||
        this.pending.actions.length >= MAX_BATCH_ACTIONS)
    );
  }
  payload(): StageCheckpoint | null {
    return this.pending ? structuredClone(this.pending) : null;
  }
  private persist() {
    try {
      this.storage().setItem(
        cacheKey(this.studentId),
        JSON.stringify({
          ...this.pending,
          schema_version: 1,
          session_id: this.session.id,
        }),
      );
      this.storageAvailable = true;
    } catch {
      this.storageAvailable = false;
    }
  }
  discard() {
    try {
      const raw = this.storage().getItem(cacheKey(this.studentId));
      if (raw && JSON.parse(raw).request_id === this.pending?.request_id)
        this.storage().removeItem(cacheKey(this.studentId));
    } catch {
      this.storageAvailable = false;
    }
    this.pending = null;
  }
  accept(server: StudentSession) {
    if (
      server.id !== this.session.id ||
      server.revision <= this.session.revision
    )
      throw new Error('保存结果与当前练习不一致，请重试');
    this.discard();
    this.session = server;
    this.baseStage = server.game.stage;
  }
}
