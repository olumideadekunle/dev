import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { PrivateKey, Transaction } from "@hashgraph/sdk";
import dotenv from "dotenv";
dotenv.config();

// Define async main function to use await
async function main() {
    console.log("Starting Hedera MCP test client...");

    // Create SSE transport to connect to the server
    // The server is running on port 3000 by default
    const transport = new SSEClientTransport(
        new URL("http://localhost:3000/sse"),
        {
            requestInit: {
                headers: {}
            }
        }
    );

    // Create MCP client
    const client = new Client(
        {
            name: "hedera-test-client",
            version: "1.0.0"
        },
        {
            capabilities: {
                // We don't need to specify any capabilities as we're just testing tools
                prompts: {},
                resources: {},
                tools: {}
            }
        }
    );

    try {
        // Connect to the server
        console.log("Connecting to Hedera MCP server...");
        await client.connect(transport);
        console.log("Connected successfully!");

        // List available tools
        console.log("\nListing available tools:");
        const tools = await client.listTools();
        console.log(JSON.stringify(tools, null, 2));

        // 1. STEP 1: Create a new wallet/account
        console.log("\n========== STEP 1: Create New Account ==========");
        const createWalletResult = await client.callTool({
            name: "create-wallet",
            arguments: {}  // This tool doesn't require any arguments
        });

        console.log("\nWallet created successfully!");

        // Parse the wallet information
        let walletData;
        if (createWalletResult.content && Array.isArray(createWalletResult.content) && createWalletResult.content.length > 0) {
            const textContent = createWalletResult.content[0].text;
            try {
                walletData = JSON.parse(textContent);
                console.log("Wallet Information:");
                console.log(`Account ID: ${walletData.accountId}`);
                console.log(`EVM Address: ${walletData.evmAddress}`);
                console.log(`Private Key: ${walletData.privateKey}`);
            } catch (error) {
                console.error("Error parsing wallet data:", error);
                console.log("Raw response:", textContent);
                return;
            }
        } else {
            console.log("Unexpected response format:", createWalletResult);
            return;
        }

        // 2. STEP 2: Check the balance of the newly created account
        console.log("\n========== STEP 2: Check Account Balance ==========");
        const checkBalanceResult = await client.callTool({
            name: "check-balance",
            arguments: {
                accountId: walletData.accountId
            }
        });

        // Parse balance information
        let balance = 0;
        if (checkBalanceResult.content && Array.isArray(checkBalanceResult.content) && checkBalanceResult.content.length > 0) {
            const balanceText = checkBalanceResult.content[0].text;
            console.log("Balance Information:", balanceText);

            // Extract the balance value from the text (format: "Balance for account X: Y tinybars")
            const balanceMatch = balanceText.match(/: (\d+) tinybars/);
            if (balanceMatch && balanceMatch[1]) {
                balance = parseInt(balanceMatch[1], 10);
                console.log(`Extracted balance: ${balance} tinybars`);
            }
        } else {
            console.log("Unexpected response format:", checkBalanceResult);
            return;
        }

        // 3. STEP 3: Build a transaction where:
        // - sender is the newly created account
        // - recipient is the operator (we'll use the env var from the server)
        // - amount is the balance of the account
        console.log("\n========== STEP 3: Build Transaction ==========");

        // We'll assume operator ID comes from the server - we'll just use the full balance from the newly created account
        const operatorId = process.env.HEDERA_OPERATOR_ID || "0.0.2"; // fallback for testing

        const buildTransactionResult = await client.callTool({
            name: "build-transaction",
            arguments: {
                senderAccountId: walletData.accountId,
                recipientAccountId: operatorId,
                amount: balance / Math.pow(10, 8) // amount is in hbar
            }
        });

        // Parse the transaction
        let base64Tx;
        if (buildTransactionResult.content && Array.isArray(buildTransactionResult.content) && buildTransactionResult.content.length > 0) {
            const txText = buildTransactionResult.content[0].text;
            console.log("Transaction built:", txText);

            // Extract the base64 transaction
            const txMatch = txText.match(/Frozen transaction \(base64\): (.+)/);
            if (txMatch && txMatch[1]) {
                base64Tx = txMatch[1];
                console.log("Extracted base64 transaction");
            } else {
                console.error("Couldn't extract transaction from response");
                return;
            }
        } else {
            console.log("Unexpected response format:", buildTransactionResult);
            return;
        }

        // 4. STEP 4: Sign the transaction and submit it
        console.log("\n========== STEP 4: Sign and Send Transaction ==========");

        // Decode the base64 transaction
        const txBytes = Buffer.from(base64Tx, "base64");
        const transaction = Transaction.fromBytes(txBytes);

        // Create private key object from the string
        const privateKey = PrivateKey.fromStringECDSA(walletData.privateKey);

        // Sign the transaction with the sender's private key
        const signedTx = await transaction.sign(privateKey);

        // Get the signed transaction bytes and encode to base64
        const signedTxBytes = signedTx.toBytes();
        const signedBase64Tx = Buffer.from(signedTxBytes).toString("base64");

        // Send the signed transaction
        const sendTransactionResult = await client.callTool({
            name: "send-transaction",
            arguments: {
                signedTransaction: signedBase64Tx
            }
        });

        // Display the result
        if (sendTransactionResult.content && Array.isArray(sendTransactionResult.content) && sendTransactionResult.content.length > 0) {
            const resultText = sendTransactionResult.content[0].text;
            console.log("Transaction Result:", resultText);
        } else {
            console.log("Unexpected response format:", sendTransactionResult);
        }

        console.log("\n========== END-TO-END TEST COMPLETED ==========");

    } catch (error) {
        console.error("Error:", error);
    } finally {
        // Close the transport connection
        transport.close();
        console.log("\nDisconnected from server");
    }
}

// Run the main function
main().catch(console.error); 