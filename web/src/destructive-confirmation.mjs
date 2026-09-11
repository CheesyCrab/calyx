export const DESTRUCTIVE_ACTION = Object.freeze({ HOME: "home", QUIT: "quit" });
export const CONFIRM_CHOICE = Object.freeze({ CANCEL: "cancel", CONFIRM: "confirm" });

export class DestructiveConfirmation {
  constructor() {
    this.action = null;
    this.choice = CONFIRM_CHOICE.CANCEL;
  }

  open(action) {
    if (!Object.values(DESTRUCTIVE_ACTION).includes(action)) throw new Error(`bad destructive action ${action}`);
    this.action = action;
    this.choice = CONFIRM_CHOICE.CANCEL;
  }

  toggle() {
    if (!this.action) return;
    this.choice = this.choice === CONFIRM_CHOICE.CANCEL
      ? CONFIRM_CHOICE.CONFIRM
      : CONFIRM_CHOICE.CANCEL;
  }

  close() {
    this.action = null;
    this.choice = CONFIRM_CHOICE.CANCEL;
  }

  acceptedAction() {
    return this.choice === CONFIRM_CHOICE.CONFIRM ? this.action : null;
  }
}
