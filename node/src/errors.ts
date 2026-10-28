export interface UserboxErrorArgs {
  code: string;
  message: string;
  status: number;
}

export class UserboxError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(args: UserboxErrorArgs) {
    super(args.message);
    this.name = "UserboxError";
    this.code = args.code;
    this.status = args.status;
    Object.setPrototypeOf(this, UserboxError.prototype);
  }
}
