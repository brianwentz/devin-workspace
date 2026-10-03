// Fake CLI for the terminal E2E: prints a ready marker, enables bracketed
// paste (ESC[?2004h) like a real shell, then echoes stdin. Non-printable
// input bytes are escaped as \xNN because ConPTY output processing drops
// raw control bytes (e.g. a pasted ^V / ^C would be invisible otherwise).
const escape = (s: string) =>
  s.replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
process.stdout.write('ready\n\x1b[?2004h');
process.stdin.on('data', (data: Buffer) => {
  process.stdout.write(`echo:${escape(data.toString())}`);
});
process.stdin.resume();
