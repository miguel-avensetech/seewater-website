// Starts the SeeWater API (server/) and admin website (admin/) together.
//   npm run dev            → real Firebase project (server/.env, admin/.env.local)
//   npm run dev:emulator   → local Firebase Emulator Suite (needs Java + `npm run emulators` in server/)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const emulator = process.argv.includes('--emulator');
const problems = [];

for (const app of ['server', 'admin']) {
  if (!existsSync(join(root, app, 'node_modules'))) problems.push(`Dependencies missing in ${app}/ → run: cd website/${app} && npm install`);
}

if (!emulator) {
  const envPath = join(root, 'server', '.env');
  if (!existsSync(envPath)) {
    problems.push('server/.env is missing → copy server/.env.example to server/.env and fill it in');
  } else {
    const env = readFileSync(envPath, 'utf8');
    const keyPath = env.match(/^GOOGLE_APPLICATION_CREDENTIALS=(.+)$/m)?.[1]?.trim();
    const inlineKey = /^FIREBASE_PRIVATE_KEY=.*PRIVATE KEY/m.test(env);
    if (keyPath && !inlineKey && !existsSync(join(root, 'server', keyPath))) {
      problems.push(
        `Firebase service-account key not found at server/${keyPath.replace(/^\.\//, '')}\n` +
          '    Firebase console → Project settings → Service accounts → Generate new private key,\n' +
          '    then save the downloaded file as website/server/serviceAccountKey.json',
      );
    }
  }
  if (!existsSync(join(root, 'admin', '.env.local'))) problems.push('admin/.env.local is missing → copy admin/.env.example to admin/.env.local');
}

if (problems.length) {
  console.error('\nCan’t start SeeWater yet:\n');
  for (const p of problems) console.error(`  • ${p}`);
  console.error('');
  process.exit(1);
}

const procs = [
  { name: 'api  ', color: 36, cwd: 'server', script: emulator ? 'dev:emulator' : 'dev' },
  { name: 'admin', color: 35, cwd: 'admin', script: emulator ? 'dev:emulator' : 'dev' },
].map(({ name, color, cwd, script }) => {
  const child = spawn('npm', ['run', script], { cwd: join(root, cwd), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(tag + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${tag}stopped (exit ${code ?? 'signal'})`);
    shutdown(code ?? 0);
  });
  return child;
});

console.log('SeeWater: API → http://localhost:4000 · Admin → http://localhost:3000   (Ctrl+C to stop)\n');

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill('SIGINT');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
