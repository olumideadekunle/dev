import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import {
    Client,
    AccountCreateTransaction,
    PrivateKey,
    AccountBalanceQuery,
    TransferTransaction,
    Transaction
} from "@hashgraph/sdk";
import dotenv from "dotenv";

dotenv.config();

// --- Hedera Client Setup ---
// Read Hedera configuration from environment variables.
const operatorId = process.env.HEDERA_OPERATOR_ID;
const operatorKey = process.env.HEDERA_OPERATOR_KEY;
const hederaNetwork = process.env.HEDERA_NETWORK || "testnet";

if (!operatorId || !operatorKey) {
    console.error("Please set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY environment variables.");
    process.exit(1);
}

// Create Hedera client instance.
const hederaClient = Client.forName(hederaNetwork);
hederaClient.setOperator(operatorId, operatorKey);


// Schema for checkBalance tool
const checkBalanceSchema = {
    accountId: z.string()
};

// Schema for buildTransaction tool
const buildTransactionSchema = {
    senderAccountId: z.string(),
    recipientAccountId: z.string(),
    amount: z.number() // amount in tinybars
};

// Schema for sendTransaction tool
const sendTransactionSchema = {
    signedTransaction: z.string() // base64-encoded transaction bytes
};

// --- Create MCP Server Instance ---
const mcpServer = new McpServer({
    name: "Hedera-MCP-Server",
    version: "1.0.0"
});

// --- Register MCP Tools ---

// 1. Create Wallet Tool
mcpServer.tool("create-wallet", "Create a new Hedera account", async () => {
    const newPrivateKey = PrivateKey.generateECDSA();
    // Create an account with a small initial balance (e.g. 100000 tinybars)
    const transaction = await new AccountCreateTransaction()
        .setECDSAKeyWithAlias(newPrivateKey)
        .setInitialBalance(1) // tinybars
        .execute(hederaClient);

    const receipt = await transaction.getReceipt(hederaClient);
    const newAccountId = receipt.accountId?.toString() || "unknown";

    return {
        content: [{
            type: "text",
            text: JSON.stringify({
                accountId: newAccountId,
                evmAddress: '0x' + newPrivateKey.publicKey.toEvmAddress(),
                privateKey: newPrivateKey.toString() // Warning: For production, NEVER return private keys!
            }, null, 2)
        }]
    };
});

// 2. Check Balance Tool
mcpServer.tool("check-balance", "Check the balance of a Hedera account", checkBalanceSchema, async ({ accountId }) => {
    const balance = await new AccountBalanceQuery()
        .setAccountId(accountId)
        .execute(hederaClient);
    return {
        content: [{
            type: "text",
            text: `Balance for account ${accountId}: ${balance.hbars.toTinybars()} tinybars`
        }]
    };
});

// 3. Build Transaction Tool
mcpServer.tool("build-transaction", "Build a transfer transaction", buildTransactionSchema, async ({ senderAccountId, recipientAccountId, amount }) => {
    // Build a transfer transaction from sender to recipient.
    // Note: We are not signing it here.
    const transferTx = new TransferTransaction()
        .addHbarTransfer(senderAccountId, -amount)
        .addHbarTransfer(recipientAccountId, amount);
    // Freeze the transaction (without signing)
    const frozenTx = await transferTx.freezeWith(hederaClient);
    // Get the transaction bytes as Buffer then encode to base64.
    const txBytes = frozenTx.toBytes();
    const base64Tx = Buffer.from(txBytes).toString("base64");
    return {
        content: [{
            type: "text",
            text: `Frozen transaction (base64): ${base64Tx}`
        }]
    };
});

// 4. Send Transaction Tool
mcpServer.tool("send-transaction", "Send a signed transaction", sendTransactionSchema, async ({ signedTransaction }) => {
    // Decode the base64-encoded transaction bytes.
    const txBytes = Buffer.from(signedTransaction, "base64");
    // Recreate the transaction object.
    const signedTx = Transaction.fromBytes(txBytes);
    // Execute the signed transaction on the Hedera network.
    const txResponse = await signedTx.execute(hederaClient);
    const receipt = await txResponse.getReceipt(hederaClient);
    return {
        content: [{
            type: "text",
            text: `Transaction executed. Status: ${receipt.status.toString()}, Transaction ID: ${txResponse.transactionId.toString()}`
        }]
    };
});

// --- Express Server & SSE Transport Setup ---

const app = express();
const PORT = process.env.PORT || 3000;

let transport: SSEServerTransport | null = null;

// SSE endpoint for server-to-client streaming
app.get("/sse", (req, res) => {
    // Create a new SSE transport with the message endpoint set to "/messages"
    transport = new SSEServerTransport("/messages", res);
    console.log("SSE transport created");
    // Connect the MCP server to this transport.
    mcpServer.connect(transport).catch(err => {
        console.error("Error connecting MCP server via SSE:", err);
    });
});

// Endpoint for client-to-server messages (HTTP POST)
app.post("/messages", (req, res) => {
    console.log("Received POST request");
    if (transport) {
        transport.handlePostMessage(req, res);
    }
});

// Start the Express server
app.listen(PORT, () => {
    console.log(`MCP Hedera Server is listening on port ${PORT}`);
});