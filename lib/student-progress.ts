import {
  advanceGame,
  replayActions,
  MAX_BATCH_ACTIONS,
  type GameAction,
  type StudentSession,
  type StudyGame,
} from './student-game';

export type StageCheckpoint = {
  revision: number;
  request_id: string;
  actions: GameAction[];
};
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Flight = { payload: StageCheckpoint; game: StudyGame };
type Draft = StageCheckpoint & {
  schema_version: 1 | 2;
  session_id: string;
  flight?: Flight | null;
};
const cacheKey = (studentId: string) => 'kite.student.progress.v1:' + studentId;
export class ProgressConflict extends Error {}
function replayPending(game: StudyGame, actions: GameAction[]) {
  if (!Array.isArray(actions) || actions.length > 10000)
    throw new Error('暂存操作不正确');
  for (let i = 0; i < actions.length; i += MAX_BATCH_ACTIONS)
    game = replayActions(game, actions.slice(i, i + MAX_BATCH_ACTIONS));
  return game;
}

/** Only unacknowledged actions live in browser storage; no passwords or profile data. */
export class StudentProgress {
  session: StudentSession;
  pending: StageCheckpoint | null = null;
  storageAvailable = true;
  private baseStage: StudentSession['game']['stage'];
  private base: StudentSession;
  private flight: Flight | null = null;
  constructor(
    private studentId: string,
    server: StudentSession,
    private storage: () => Storage = () => localStorage,
  ) {
    this.session = server;
    this.base = server;
    this.baseStage = server.game.stage;
    try {
      const raw = this.storage().getItem(cacheKey(studentId));
      if (!raw) return;
      const draft: Draft = JSON.parse(raw);
      if (
        (draft.schema_version === 1 || draft.schema_version === 2) &&
        draft.session_id === server.id &&
        typeof draft.request_id === 'string' &&
        /^[a-zA-Z0-9_-]{12,80}$/.test(draft.request_id)
      ) {
        if (draft.revision === server.revision) {
          this.session = {
            ...server,
            game: replayPending(server.game, draft.actions),
          };
          this.pending = {
            revision: draft.revision,
            request_id: draft.request_id,
            actions: draft.actions,
          };
          this.flight = draft.flight || null;
        } else if (
          draft.flight &&
          server.revision === draft.flight.payload.revision + 1 &&
          JSON.stringify(server.game) === JSON.stringify(draft.flight.game) &&
          JSON.stringify(
            draft.actions.slice(0, draft.flight.payload.actions.length),
          ) === JSON.stringify(draft.flight.payload.actions)
        ) {
          // The server committed before the browser received its response. Keep the newer local answers.
          const tail = draft.actions.slice(draft.flight.payload.actions.length);
          this.session = { ...server, game: replayPending(server.game, tail) };
          this.pending = tail.length
            ? {
                revision: server.revision,
                request_id: crypto.randomUUID(),
                actions: tail,
              }
            : null;
          if (this.pending) this.persist();
          else this.storage().removeItem(cacheKey(studentId));
        } else this.storage().removeItem(cacheKey(studentId));
      } else this.storage().removeItem(cacheKey(studentId));
    } catch {
      // An invalid draft cannot replace authoritative progress; unavailable storage
      // must not turn each answer back into a blocking network request.
      this.storageAvailable = false;
    }
  }
  choose(action: GameAction) {
    if ((this.pending?.actions.length || 0) >= 10000)
      throw new Error('本机暂存已满，请先同步进度');
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
    return this.flight
      ? structuredClone(this.flight.payload)
      : this.pending
        ? structuredClone(this.pending)
        : null;
  }
  /** Freeze an immutable request while later answers append to the local tail. */
  beginCheckpoint(): StageCheckpoint | null {
    if (!this.flight && this.pending) {
      const payload = {
        ...this.pending,
        actions: this.pending.actions.slice(0, MAX_BATCH_ACTIONS),
      };
      this.flight = {
        payload,
        game: replayActions(this.base.game, payload.actions),
      };
      this.persist();
    }
    return this.flight ? structuredClone(this.flight.payload) : null;
  }
  private persist() {
    try {
      this.storage().setItem(
        cacheKey(this.studentId),
        JSON.stringify({
          ...this.pending,
          schema_version: 2,
          session_id: this.session.id,
          flight: this.flight,
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
    this.flight = null;
  }
  accept(server: StudentSession) {
    const sent = this.flight?.payload || this.pending;
    if (
      !sent ||
      !this.pending ||
      server.id !== this.session.id ||
      server.revision !== sent.revision + 1 ||
      JSON.stringify(this.pending.actions.slice(0, sent.actions.length)) !==
        JSON.stringify(sent.actions) ||
      JSON.stringify(server.game) !==
        JSON.stringify(
          this.flight?.game || replayActions(this.base.game, sent.actions),
        )
    )
      throw new ProgressConflict('保存结果与当前练习不一致，请继续最新进度');
    let ownsDraft = false;
    try {
      const raw = this.storage().getItem(cacheKey(this.studentId));
      ownsDraft =
        !!raw && JSON.parse(raw).request_id === this.pending.request_id;
    } catch {
      this.storageAvailable = false;
    }
    const tail = this.pending.actions.slice(sent.actions.length);
    this.pending = tail.length
      ? {
          revision: server.revision,
          request_id: crypto.randomUUID(),
          actions: tail,
        }
      : null;
    this.flight = null;
    this.base = server;
    this.session = { ...server, game: replayPending(server.game, tail) };
    this.baseStage = server.game.stage;
    if (ownsDraft) {
      if (this.pending) this.persist();
      else {
        try {
          this.storage().removeItem(cacheKey(this.studentId));
        } catch {
          this.storageAvailable = false;
        }
      }
    }
  }
}
