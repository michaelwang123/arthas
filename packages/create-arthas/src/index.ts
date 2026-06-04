#!/usr/bin/env node

/**
 * create-arthas — One-command self-hosted Arthas deployment scaffolding.
 *
 * Usage:
 *   npx create-arthas
 *   npx create-arthas --defaults (skip prompts, use defaults)
 *
 * Generates:
 *   ./arthas/docker-compose.yml
 *   ./arthas/.env
 *   ./arthas/Caddyfile
 *
 * Then optionally runs `docker compose up -d`.
 */

import prompts from 'prompts';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { generateDockerCompose } from './templates/docker-compose.js';
import { generateEnv } from './templates/env.js';
import { generateCaddyfile } from './templates/caddyfile.js';

interface Config {
  port: number;
  domain: string;
  email: string;
  https: boolean;
  githubOwner: string;
  version: string;
  autoStart: boolean;
}

const DEFAULT_CONFIG: Config = {
  port: 8080,
  domain: 'localhost',
  email: '',
  https: false,
  githubOwner: 'michaelwang123',
  version: 'latest',
  autoStart: true,
};

async function main(): Promise<void> {
  console.log('\n🔒 create-arthas — Self-hosted E2EE chat in seconds\n');

  const useDefaults = process.argv.includes('--defaults');
  let config: Config;

  if (useDefaults) {
    config = { ...DEFAULT_CONFIG };
    console.log('  Using default configuration (localhost:8080, no HTTPS)\n');
  } else {
    const answers = await prompts([
      {
        type: 'text',
        name: 'domain',
        message: 'Domain name (or "localhost" for local testing)',
        initial: 'localhost',
      },
      {
        type: 'number',
        name: 'port',
        message: 'Port number',
        initial: 8080,
        validate: (v: number) => (v > 0 && v < 65536) || 'Must be 1-65535',
      },
      {
        type: (prev: string) => prev !== 'localhost' ? 'confirm' : null,
        name: 'https',
        message: 'Enable HTTPS (auto Let\'s Encrypt)?',
        initial: true,
      },
      {
        type: (_, values) => values.https ? 'text' : null,
        name: 'email',
        message: 'Email for Let\'s Encrypt certificate',
        validate: (v: string) => v.includes('@') || 'Must be a valid email',
      },
      {
        type: 'text',
        name: 'githubOwner',
        message: 'GitHub owner (for Docker image ghcr.io/{owner}/arthas)',
        initial: 'michaelwang123',
      },
      {
        type: 'text',
        name: 'version',
        message: 'Arthas version (Docker image tag)',
        initial: 'latest',
      },
      {
        type: 'confirm',
        name: 'autoStart',
        message: 'Start containers now? (requires Docker)',
        initial: true,
      },
    ], {
      onCancel: () => {
        console.log('\n  Cancelled.\n');
        process.exit(0);
      },
    });

    config = {
      port: answers.port ?? DEFAULT_CONFIG.port,
      domain: answers.domain ?? DEFAULT_CONFIG.domain,
      email: answers.email ?? DEFAULT_CONFIG.email,
      https: answers.https ?? DEFAULT_CONFIG.https,
      githubOwner: answers.githubOwner ?? DEFAULT_CONFIG.githubOwner,
      version: answers.version ?? DEFAULT_CONFIG.version,
      autoStart: answers.autoStart ?? DEFAULT_CONFIG.autoStart,
    };
  }

  // Determine output directory
  const outDir = join(process.cwd(), 'arthas');

  if (existsSync(outDir)) {
    console.log(`\n  ⚠ Directory ./arthas/ already exists. Files will be overwritten.\n`);
  }

  mkdirSync(outDir, { recursive: true });

  // Generate files
  const dockerCompose = generateDockerCompose(config);
  const envFile = generateEnv(config);
  const caddyfile = generateCaddyfile(config);

  writeFileSync(join(outDir, 'docker-compose.yml'), dockerCompose);
  writeFileSync(join(outDir, '.env'), envFile);

  console.log('\n  ✓ Generated files:');
  console.log('    ./arthas/docker-compose.yml');
  console.log('    ./arthas/.env');

  if (config.https) {
    writeFileSync(join(outDir, 'Caddyfile'), caddyfile);
    console.log('    ./arthas/Caddyfile');
  }

  // Auto-start
  if (config.autoStart) {
    console.log('\n  Starting containers...\n');
    try {
      execSync('docker compose up -d', { cwd: outDir, stdio: 'inherit' });
      const url = config.https ? `https://${config.domain}` : `http://${config.domain}:${config.port}`;
      console.log(`\n  🎉 Arthas is running at ${url}`);
      console.log(`     WebSocket: ${config.https ? 'wss' : 'ws'}://${config.domain}${config.https ? '' : ':' + config.port}/ws`);
      console.log('\n  Commands:');
      console.log('    cd arthas && docker compose logs -f    # View logs');
      console.log('    cd arthas && docker compose down       # Stop');
      console.log('    cd arthas && docker compose pull       # Update\n');
    } catch {
      console.log('\n  ⚠ Failed to start. Make sure Docker is installed and running.');
      console.log('    To start manually: cd arthas && docker compose up -d\n');
    }
  } else {
    console.log('\n  To start: cd arthas && docker compose up -d\n');
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
