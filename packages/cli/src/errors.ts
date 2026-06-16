export class CliUsageError extends Error {
  readonly title: string;

  constructor(message: string, title = "Usage error") {
    super(message);
    this.title = title;
  }
}
