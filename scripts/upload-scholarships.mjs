#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

/**
 * Upload the scholarship catalog to 0G Storage (Galileo testnet).
 *
 * Usage:
 *   OG_TESTNET_PRIVATE_KEY=0x... node scripts/upload-scholarships.mjs
 *
 * The script prints the root hash, tx hash, and txSeq. Add the root hash to
 * NEXT_PUBLIC_SCHOLARSHIP_ROOT_HASH in .env.local so the app fetches from 0G.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = process.env.OG_TESTNET_RPC_URL || 'https://evmrpc-testnet.0g.ai';
const INDEXER_URL = process.env.OG_TESTNET_INDEXER_URL || 'https://indexer-storage-testnet-turbo.0g.ai';
const PRIVATE_KEY = process.env.OG_TESTNET_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error('Error: Set OG_TESTNET_PRIVATE_KEY environment variable.');
  console.error('Get testnet tokens from https://faucet.0g.ai');
  process.exit(1);
}

async function main() {
  const dataPath = path.resolve(__dirname, '../app/lib/scholarships.json');
  const raw = fs.readFileSync(dataPath);

  console.log(`Uploading ${(raw.length / 1024).toFixed(2)} KB scholarship catalog to 0G Storage testnet...`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Indexer: ${INDEXER_URL}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const address = await signer.getAddress();
  console.log(`Signer: ${address}`);

  const balance = await provider.getBalance(address);
  console.log(`Balance: ${ethers.formatEther(balance)} 0G`);

  if (balance === 0n) {
    console.error('Error: Wallet has no testnet 0G tokens. Visit https://faucet.0g.ai');
    process.exit(1);
  }

  const indexer = new Indexer(INDEXER_URL);
  const memData = new MemData(raw);

  const [result, err] = await indexer.upload(memData, RPC_URL, signer, {
    expectedReplica: 1,
    tags: new TextEncoder().encode('scholarpilot-scholarships'),
  });

  if (err) {
    console.error('Upload failed:', err);
    process.exit(1);
  }

  // upload() may return a single result or an array result for multi-root uploads.
  const single = 'rootHash' in result ? result : result.rootHashes?.[0] ? {
    rootHash: result.rootHashes[0],
    txHash: result.txHashes[0],
    txSeq: result.txSeqs[0],
  } : null;

  if (!single) {
    console.error('Unexpected upload result:', result);
    process.exit(1);
  }

  console.log('\n✅ Upload successful\n');
  console.log(`Root Hash: ${single.rootHash}`);
  console.log(`Tx Hash:   ${single.txHash}`);
  console.log(`Tx Seq:    ${single.txSeq}`);
  console.log(`Explorer:  https://storagescan-galileo.0g.ai/tx/${single.txHash}`);
  console.log(`\nAdd this to .env.local:`);
  console.log(`NEXT_PUBLIC_SCHOLARSHIP_ROOT_HASH=${single.rootHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
