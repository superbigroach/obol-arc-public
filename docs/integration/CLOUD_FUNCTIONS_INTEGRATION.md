# Obol MCP Integration in Cloud Functions

## Overview

Cloud Functions can use the Obol MCP to integrate metered AI services. This document shows how to set up and call Obol MCP tools from TypeScript Cloud Functions.

---

## Architecture

```
Cloud Function
    ↓
Child Process (MCP Server)
    ↓ (stdin/stdout)
    ↓
Obol MCP Server (@superbigroach/obol-mcp)
    ↓
Obol API (obol-arc.web.app)
    ↓
Arc Blockchain (USDC escrow + metering)
```

---

## Setup

### 1. Environment Variables

Add to `functions/.env`:

```bash
# Public seller key (safe in .env)
OBOL_API_KEY=obl_sk_live_YOUR_KEY_HERE

# Buyer private key (stored in Secret Manager)
OBOL_AGENT_KEY=${OBOL_AGENT_KEY}

# Facilitator private key (stored in Secret Manager, mainnet only)
OBOL_FACILITATOR_PRIVATE_KEY=${OBOL_FACILITATOR_PRIVATE_KEY}

# Network config
OBOL_NETWORK=arc-mainnet
OBOL_BASE_URL=https://obol-arc.web.app/api
OBOL_TIMEOUT_MS=30000
OBOL_RETRY_MAX=3
OBOL_RETRY_DELAY_MS=1000
```

### 2. Deploy with Secret Manager Bindings

```bash
cd functions
npm run build
firebase deploy --only functions --project lucilla-b0493
```

Firebase automatically injects Secret Manager secrets into the runtime environment.

### 3. Verify Secrets are Accessible

```bash
firebase functions:log --limit 10
# Should show Cloud Functions starting without "OBOL_AGENT_KEY not found" errors
```

---

## Creating an Obol MCP Client

### Option 1: Simple Wrapper (Recommended)

Create `functions/src/mcp/obol-client.ts`:

```typescript
import { spawn, SpawnOptions } from 'child_process';
import { logger } from 'firebase-functions';

interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image';
    text?: string;
  }>;
}

/**
 * Execute an Obol MCP tool call via the @superbigroach/obol-mcp server.
 * 
 * @param toolName - Tool name: find_service, list_service, pay_and_call, get_balance, deposit
 * @param args - Tool arguments
 * @returns Tool result
 */
export async function executeObolMCP(
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      OBOL_API_KEY: process.env.OBOL_API_KEY,
      OBOL_AGENT_KEY: process.env.OBOL_AGENT_KEY,
      OBOL_FACILITATOR_PRIVATE_KEY: process.env.OBOL_FACILITATOR_PRIVATE_KEY,
      OBOL_NETWORK: process.env.OBOL_NETWORK || 'arc-mainnet',
      OBOL_BASE_URL: process.env.OBOL_BASE_URL,
      OBOL_TIMEOUT_MS: process.env.OBOL_TIMEOUT_MS || '30000',
      OBOL_RETRY_MAX: process.env.OBOL_RETRY_MAX || '3',
      OBOL_RETRY_DELAY_MS: process.env.OBOL_RETRY_DELAY_MS || '1000',
    };

    const options: SpawnOptions = {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000, // 60 second timeout
    };

    // Spawn the MCP server
    const mcpProcess = spawn('npx', ['-y', '@superbigroach/obol-mcp'], options);

    let stdout = '';
    let stderr = '';

    mcpProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    mcpProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
      logger.warn(`Obol MCP stderr: ${data.toString()}`);
    });

    mcpProcess.on('error', (error) => {
      logger.error('MCP process error:', error);
      reject(new Error(`Obol MCP error: ${error.message}`));
    });

    mcpProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Obol MCP exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Parse the MCP response
        const result = JSON.parse(stdout) as MCPToolResult;
        const text = result.content?.[0]?.text;
        const parsedResult = text ? JSON.parse(text) : result;
        resolve(parsedResult);
      } catch (error) {
        reject(new Error(`Failed to parse Obol MCP response: ${error}`));
      }
    });

    // Send tool call request
    const toolCall: MCPToolCall = {
      name: toolName,
      arguments: args,
    };

    mcpProcess.stdin?.write(JSON.stringify(toolCall) + '\n');
    mcpProcess.stdin?.end();
  });
}

/**
 * List all available Obol services
 */
export async function listObolServices() {
  return executeObolMCP('list_service', {});
}

/**
 * Find a service by query
 */
export async function findObolService(query: string) {
  return executeObolMCP('find_service', { query });
}

/**
 * Make a metered API call via Obol
 */
export async function callObolService(
  serviceId: string,
  request: Record<string, unknown>,
  buyerKey?: string
) {
  const key = buyerKey || process.env.OBOL_AGENT_KEY;
  if (!key) {
    throw new Error('OBOL_AGENT_KEY not found in environment');
  }

  return executeObolMCP('pay_and_call', {
    service_id: serviceId,
    request,
    buyer_key: key,
  });
}

/**
 * Check wallet balance
 */
export async function getObolBalance(walletAddress: string) {
  return executeObolMCP('get_balance', {
    wallet_address: walletAddress,
  });
}

/**
 * Deposit USDC to facilitator wallet
 */
export async function depositObolFunds(
  walletAddress: string,
  amountUsdc: number,
  facilitatorKey?: string
) {
  const key = facilitatorKey || process.env.OBOL_FACILITATOR_PRIVATE_KEY;
  if (!key) {
    throw new Error('OBOL_FACILITATOR_PRIVATE_KEY not found in environment');
  }

  return executeObolMCP('deposit', {
    wallet_address: walletAddress,
    amount_usdc: amountUsdc,
    facilitator_key: key,
  });
}
```

---

## Cloud Function Examples

### Example 1: List Available Services

```typescript
import { onCall } from 'firebase-functions/v2/https';
import { listObolServices } from './mcp/obol-client';
import { combineMiddleware, requireAuth, createRateLimiter, RateLimits } from './middleware';

/**
 * Cloud Function: List available Obol services
 * 
 * Usage:
 *   const result = await httpsCallable(functions, 'listObolServicesCF')({});
 */
export const listObolServicesCF = onCall(
  { enforceAppCheck: true },
  async (request) => {
    await combineMiddleware([
      requireAuth({ required: true }),
      createRateLimiter(RateLimits.STANDARD),
    ])(request);

    try {
      const services = await listObolServices();
      return {
        success: true,
        services,
        count: Array.isArray(services) ? services.length : 0,
      };
    } catch (error) {
      throw new Error(`Failed to list Obol services: ${error}`);
    }
  }
);
```

### Example 2: Call an AI Service via Obol

```typescript
import { onCall } from 'firebase-functions/v2/https';
import { callObolService } from './mcp/obol-client';
import { combineMiddleware, requireAuth, createRateLimiter, RateLimits } from './middleware';
import { logger } from 'firebase-functions';

interface CallAIRequest {
  serviceId: string; // e.g., "svc_openai_gpt4"
  prompt: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Cloud Function: Call an AI service via Obol metering
 * 
 * Usage:
 *   const result = await httpsCallable(functions, 'callObolAICF')({
 *     serviceId: 'svc_openai_gpt4',
 *     prompt: 'What is the Obol MCP?',
 *     maxTokens: 500
 *   });
 */
export const callObolAICF = onCall(
  { enforceAppCheck: true },
  async (request) => {
    await combineMiddleware([
      requireAuth({ required: true }),
      createRateLimiter(RateLimits.AGENT_CALL), // Lower rate limit for AI calls
    ])(request);

    const { serviceId, prompt, model, maxTokens } = request.data as CallAIRequest;

    if (!serviceId) {
      throw new Error('serviceId is required');
    }
    if (!prompt) {
      throw new Error('prompt is required');
    }

    try {
      logger.info(`Calling Obol service: ${serviceId}`, { uid: request.auth?.uid });

      const result = await callObolService(serviceId, {
        prompt,
        model: model || 'gpt-4',
        max_tokens: maxTokens || 1000,
      });

      // Log usage for cost tracking
      const costUsdc = (result as any).cost_usdc || 0;
      if (costUsdc > 0) {
        logger.info(`Obol call cost: $${costUsdc.toFixed(4)}`, {
          uid: request.auth?.uid,
          serviceId,
        });
      }

      return {
        success: true,
        result: (result as any).result,
        costUsdc: (result as any).cost_usdc,
        transactionHash: (result as any).transaction_hash,
      };
    } catch (error) {
      logger.error(`Failed to call Obol service: ${error}`, { serviceId });
      throw new Error(`AI service call failed: ${error}`);
    }
  }
);
```

### Example 3: Monitor Obol Balance

```typescript
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getObolBalance } from './mcp/obol-client';
import { logger } from 'firebase-functions';

/**
 * Scheduled Cloud Function: Check Obol facilitator balance
 * 
 * Runs daily at 9 AM UTC
 */
export const monitorObolBalance = onSchedule(
  'every day 09:00',
  async (context) => {
    const facilitatorAddress = process.env.OBOL_FACILITATOR_ADDRESS;
    if (!facilitatorAddress) {
      logger.warn('OBOL_FACILITATOR_ADDRESS not configured');
      return;
    }

    try {
      const balance = await getObolBalance(facilitatorAddress);
      const balanceUsdc = (balance as any).balance_usdc || 0;

      logger.info(`Obol facilitator balance: $${balanceUsdc.toFixed(2)}`, {
        facilitator: facilitatorAddress,
      });

      // Alert if balance is low
      if (balanceUsdc < 100) {
        logger.warn(`⚠️ Obol balance low: $${balanceUsdc.toFixed(2)} (< $100 threshold)`, {
          facilitator: facilitatorAddress,
        });
        // TODO: Send Slack alert
      }

      return { success: true, balance: balanceUsdc };
    } catch (error) {
      logger.error(`Failed to check Obol balance: ${error}`);
      // Don't throw — keep the function alive for retry
    }
  }
);
```

### Example 4: Deposit Funds to Obol

```typescript
import { onCall } from 'firebase-functions/v2/https';
import { depositObolFunds } from './mcp/obol-client';
import { combineMiddleware, requireAuth, createRateLimiter, RateLimits } from './middleware';
import { logger } from 'firebase-functions';

interface DepositRequest {
  walletAddress: string;
  amountUsdc: number;
}

/**
 * Cloud Function: Deposit USDC to Obol facilitator wallet
 * 
 * ⚠️ Requires OBOL_FACILITATOR_PRIVATE_KEY in environment
 * 
 * Usage (admin only):
 *   const result = await httpsCallable(functions, 'depositObolFundsCF')({
 *     walletAddress: '0x...',
 *     amountUsdc: 100
 *   });
 */
export const depositObolFundsCF = onCall(
  { enforceAppCheck: true },
  async (request) => {
    // Only admins can deposit funds
    if (request.auth?.token?.admin !== true) {
      throw new Error('Only admins can deposit funds');
    }

    await combineMiddleware([
      requireAuth({ required: true }),
      createRateLimiter(RateLimits.ADMIN), // Very low rate limit
    ])(request);

    const { walletAddress, amountUsdc } = request.data as DepositRequest;

    if (!walletAddress) {
      throw new Error('walletAddress is required');
    }
    if (!amountUsdc || amountUsdc <= 0) {
      throw new Error('amountUsdc must be > 0');
    }
    if (amountUsdc > 10000) {
      throw new Error('Cannot deposit more than $10,000 per transaction');
    }

    try {
      logger.info(`Depositing ${amountUsdc} USDC to Obol`, {
        uid: request.auth?.uid,
        walletAddress,
      });

      const result = await depositObolFunds(walletAddress, amountUsdc);

      logger.info(`Obol deposit successful`, {
        uid: request.auth?.uid,
        walletAddress,
        amount: amountUsdc,
        txHash: (result as any).transaction_hash,
      });

      return {
        success: true,
        transactionHash: (result as any).transaction_hash,
        status: (result as any).status,
      };
    } catch (error) {
      logger.error(`Obol deposit failed: ${error}`, { walletAddress, amountUsdc });
      throw new Error(`Deposit failed: ${error}`);
    }
  }
);
```

---

## Error Handling

### Common Errors and Recovery

```typescript
async function callObolWithRetry(
  serviceId: string,
  request: Record<string, unknown>,
  maxRetries = 3
) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await callObolService(serviceId, request);
    } catch (error) {
      lastError = error;
      const errorMessage = (error as Error).message;

      // Classify error
      if (errorMessage.includes('timeout')) {
        logger.warn(`Obol timeout (attempt ${attempt + 1}/${maxRetries})`);
        // Wait and retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }

      if (errorMessage.includes('Insufficient USDC')) {
        logger.error('⚠️ Obol balance insufficient — please deposit funds');
        throw new Error('Service temporarily unavailable (insufficient funds)');
      }

      if (errorMessage.includes('Unknown service')) {
        logger.error(`Service not found: ${serviceId}`);
        throw new Error(`Unknown service: ${serviceId}`);
      }

      // Unknown error — don't retry
      throw error;
    }
  }

  throw new Error(`Obol call failed after ${maxRetries} retries: ${lastError}`);
}
```

---

## Testing

### Local Testing with Emulator

```bash
# In one terminal, start the emulator
firebase emulators:start --only functions

# In another terminal, test the function
curl -X POST http://localhost:5001/lucilla-b0493/us-central1/listObolServicesCF \
  -H "Content-Type: application/json" \
  -d '{}' \
  -H "Authorization: Bearer <ID_TOKEN>"
```

### Integration Testing

```typescript
import { initializeApp } from 'firebase/app';
import { connectFunctionsEmulator, httpsCallable } from 'firebase/functions';

describe('Obol MCP Integration', () => {
  beforeEach(() => {
    const app = initializeApp({
      projectId: 'lucilla-b0493',
    });
    connectFunctionsEmulator(app, 'localhost', 5001);
  });

  test('listObolServicesCF returns services', async () => {
    const result = await httpsCallable(functions, 'listObolServicesCF')({});
    expect(result.data.success).toBe(true);
    expect(Array.isArray(result.data.services)).toBe(true);
  });

  test('callObolAICF makes a metered API call', async () => {
    const result = await httpsCallable(functions, 'callObolAICF')({
      serviceId: 'svc_openai_gpt4',
      prompt: 'Hello',
      maxTokens: 100,
    });
    expect(result.data.success).toBe(true);
    expect(result.data.costUsdc).toBeGreaterThan(0);
  });
});
```

---

## Deployment Checklist

- [ ] All environment variables set in `functions/.env`
- [ ] Secret Manager secrets created (OBOL_AGENT_KEY, OBOL_FACILITATOR_PRIVATE_KEY)
- [ ] Cloud Functions service account has Secret Manager access
- [ ] Rate limiting configured (prevent abuse)
- [ ] Error handling logs secrets are redacted
- [ ] Obol balance monitoring is active
- [ ] Test all Cloud Functions in emulator before deploying
- [ ] Verify functions log to Cloud Logging
- [ ] Set up alerts for balance < $100

---

## Troubleshooting

### Error: OBOL_AGENT_KEY not found

**Fix**: Create Secret Manager entry:
```bash
echo -n "0x..." | gcloud secrets versions add OBOL_AGENT_KEY --data-file=-
```

### Error: MCP process timeout

**Fix**: Increase timeout in cloud function code:
```typescript
const options: SpawnOptions = {
  timeout: 120_000, // 120 seconds
};
```

### Error: Service not found: svc_openai_gpt4

**Fix**: List available services:
```bash
curl https://lucilla-b0493.cloudfunctions.net/listObolServicesCF
# Check the response for available service IDs
```

---

## Cost Monitoring

Track Obol usage costs in Cloud Logging:

```bash
# View all Obol calls and their costs
gcloud logging read "resource.type=cloud_function AND textPayload=~'Obol call cost'" \
  --limit 100 \
  --format json | jq '.[].textPayload'

# Total cost for the week
gcloud logging read "resource.type=cloud_function AND textPayload=~'Obol call cost'" \
  --limit 1000 \
  --format json | \
  jq '.[].textPayload | capture("cost: \\$(?<cost>[0-9.]+)").cost | tonumber' | \
  awk '{sum += $1} END {printf "Total: $%.2f\n", sum}'
```

---

## References

- **Obol MCP**: https://github.com/superbigroach/obol-mcp
- **Firebase Functions**: https://firebase.google.com/docs/functions
- **MCP Spec**: https://spec.modelcontextprotocol.io
- **Secret Manager**: https://cloud.google.com/secret-manager/docs
