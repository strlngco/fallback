import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertApiVersion, assertShopDomain } from '@strlngco/fallback-shopify';

const ENV_FILE_NAME = '.env';
const FALLBACK_DIR = '.fallback';

export class MissingEnvError extends Error {
  override readonly name = 'MissingEnvError';
  readonly missing: readonly string[];
  constructor(message: string, missing: readonly string[]) {
    super(message);
    this.missing = missing;
  }
}

export class ScopeError extends Error {
  override readonly name = 'ScopeError';
}

export class InvalidOptionError extends Error {
  override readonly name = 'InvalidOptionError';
}

export class SnapshotNotFoundError extends Error {
  override readonly name = 'SnapshotNotFoundError';
}

export interface ResolveAuthOptions {
  shopOverride?: string | undefined;
  cwd: string;
  homeDir: string;
  processEnv: Record<string, string | undefined>;
}

export interface ResolvedAuth {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  apiVersion: string | undefined;
}

export async function resolveAuth(options: ResolveAuthOptions): Promise<ResolvedAuth> {
  const fileEnv = await loadEnvFiles(options.cwd, options.homeDir);

  const lookup = (key: string): string | undefined => {
    const fromProcess = options.processEnv[key];
    if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
    const fromFile = fileEnv[key];
    if (fromFile !== undefined && fromFile !== '') return fromFile;
    return undefined;
  };

  const shopDomain = (options.shopOverride ?? lookup('SHOPIFY_SHOP_DOMAIN'))?.trim() || undefined;
  const clientId = lookup('SHOPIFY_CLIENT_ID')?.trim() || undefined;
  const clientSecret = lookup('SHOPIFY_CLIENT_SECRET')?.trim() || undefined;
  const apiVersion = lookup('SHOPIFY_API_VERSION')?.trim() || undefined;

  const missing: string[] = [];
  if (!shopDomain) missing.push('SHOPIFY_SHOP_DOMAIN');
  if (!clientId) missing.push('SHOPIFY_CLIENT_ID');
  if (!clientSecret) missing.push('SHOPIFY_CLIENT_SECRET');

  if (missing.length > 0) {
    const word = missing.length > 1 ? 'variables' : 'variable';
    throw new MissingEnvError(
      `Missing required environment ${word}: ${missing.join(', ')}. ` +
        'SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET come from your Shopify Dev Dashboard app. ' +
        'Set them in the environment, in .env at the project root, or in ~/.fallback/.env.',
      missing,
    );
  }

  assertShopDomain(shopDomain as string);
  if (apiVersion !== undefined) assertApiVersion(apiVersion);

  return {
    shopDomain: shopDomain as string,
    clientId: clientId as string,
    clientSecret: clientSecret as string,
    apiVersion,
  };
}

export async function resolveShopDomain(opts: {
  cwd: string;
  homeDir: string;
  processEnv: Record<string, string | undefined>;
}): Promise<string | undefined> {
  const fromProcess = opts.processEnv['SHOPIFY_SHOP_DOMAIN'];
  if (fromProcess !== undefined && fromProcess.trim() !== '') return fromProcess.trim();
  const fileEnv = await loadEnvFiles(opts.cwd, opts.homeDir);
  const fromFile = fileEnv['SHOPIFY_SHOP_DOMAIN'];
  if (fromFile !== undefined && fromFile.trim() !== '') return fromFile.trim();
  return undefined;
}

async function loadEnvFiles(cwd: string, homeDir: string): Promise<Record<string, string>> {
  const merged: Record<string, string> = {};
  await mergeEnvFile(merged, join(homeDir, FALLBACK_DIR, ENV_FILE_NAME));
  await mergeEnvFile(merged, join(cwd, ENV_FILE_NAME));
  return merged;
}

async function mergeEnvFile(target: Record<string, string>, path: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(path, 'utf-8');
  } catch {
    return;
  }
  Object.assign(target, parseEnvFile(content));
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (key.length === 0) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}
