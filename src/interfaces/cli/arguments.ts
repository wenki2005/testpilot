export function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function reportPath(recordPath: string): string {
  return recordPath.replaceAll("\\", "/").replace(/run\.json$/, "report.md");
}
