import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const pick = (name) => pkg.dependencies?.[name] || pkg.devDependencies?.[name] || 'unknown';

const npmVersion = execSync('npm -v').toString().trim();

const versions = {
  node: process.version,
  npm: npmVersion,
  vite: pick('vite'),
  react: pick('react'),
  typescript: pick('typescript'),
  tailwindcss: pick('tailwindcss'),
  tiptap: pick('@tiptap/core'),
  fastify: pick('fastify'),
  kysely: pick('kysely'),
  'better-sqlite3': pick('better-sqlite3'),
  argon2: pick('argon2')
};

for (const [name, version] of Object.entries(versions)) {
  console.log(`${name}: ${version}`);
}
