// Fake CLI for the terminal E2E: prints a ready marker then echoes stdin.
process.stdout.write('ready\n');
process.stdin.on('data', (data: Buffer) => {
  process.stdout.write(`echo:${data.toString()}`);
});
process.stdin.resume();
