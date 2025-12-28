const cluster = require('cluster');
const { ethers } = require('ethers');
const WebSocket = require('ws');

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", silver: "\x1b[38;5;250m"
};

const RPC_URLS = [process.env.QUICKNODE_HTTP, "https://mainnet.base.org"].filter(u => u);
const WSS_POOL = [process.env.QUICKNODE_WSS, "wss://base-rpc.publicnode.com"].filter(u => u);

const TARGET_CONTRACT = "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0";
const DATA_HEX = "0x535a720a" + "0000000000000000000000004200000000000000000000000000000000000006" + "0000000000000000000000004edbc9ba171790664872997239bc7a3f3a633190" + "0000000000000000000000000000000000000000000000015af1d78b58c40000";

if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}╔═══════════════════════════════════════════════╗${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║      🔱 APEX v35.0.0 | MACH-1 ACCELERATED     ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}╚═══════════════════════════════════════════════╝${TXT.reset}\n`);
    cluster.fork();
    cluster.on('exit', () => process.exit(1));
} else {
    runWorker();
}

async function runWorker() {
    const mesh = new ethers.FallbackProvider(RPC_URLS.map(url => new ethers.JsonRpcProvider(url, 8453, { staticNetwork: true })), 1);
    const signer = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY, mesh);
    
    const seenHashes = new Set();
    let currentPoolIndex = 0;
    let ws = null;
    let lastActive = Date.now();
    let txCount = 0;

    // 🏎️ ACCELERATOR: LOCAL NONCE TRACKING
    // This removes the 50ms-100ms delay of asking the node for a nonce before every strike.
    let nextNonce = await mesh.getTransactionCount(signer.address, 'pending');
    process.stdout.write(`${TXT.cyan}[INIT] Local Nonce Synced: ${nextNonce}${TXT.reset}\n`);

    // 🕵️ SCANNING TICKER (Updates every 2 seconds)
    setInterval(() => {
        const uptime = Math.floor(process.uptime());
        process.stdout.write(`\r${TXT.dim}[SCANNING]${TXT.reset} ${TXT.cyan}Mach-1 Stream Active${TXT.reset} | ${TXT.silver}Observed: ${txCount}${TXT.reset} | ${TXT.dim}Nonce: ${nextNonce}${TXT.reset}   `);
    }, 2000);

    // ⏲️ HEALTH WATCHDOG (5 Min)
    setInterval(() => {
        if (Date.now() - lastActive > 300000) process.exit(1);
    }, 10000);

    function connect() {
        if (ws) ws.terminate();
        const url = WSS_POOL[currentPoolIndex];
        ws = new WebSocket(url);

        ws.on('open', () => {
            process.stdout.write(`\n${TXT.green}📡 CONNECTION ESTABLISHED: ${url.split('/')[2]}${TXT.reset}\n`);
            ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactionsWithBody"] }));
            lastActive = Date.now();
        });

        ws.on('message', (raw) => {
            lastActive = Date.now();
            txCount++;
            try {
                const tx = JSON.parse(raw).params?.result;
                if (tx && tx.hash) executeStrike(tx);
            } catch (e) {}
        });

        ws.on('close', () => {
            currentPoolIndex = (currentPoolIndex + 1) % WSS_POOL.length;
            setTimeout(connect, 2000);
        });
        ws.on('error', () => ws.terminate());
    }

    async function executeStrike(tx) {
        if (seenHashes.has(tx.hash)) return;
        seenHashes.add(tx.hash);

        if (BigInt(tx.value || 0) < 50000000000000000n) return;

        try {
            process.stdout.write(`\n${TXT.bold}${TXT.magenta}⚡ TARGET ACQUIRED: ${tx.hash.slice(0,14)}...${TXT.reset}\n`);
            
            // ⚡ ZERO-ROUND-TRIP EXECUTION
            const strikeNonce = nextNonce++; // Use and increment immediately in memory
            const balanceBefore = await mesh.getBalance(signer.address);

            // Fire and forget (Signer does RLP encoding and signing locally)
            const responsePromise = signer.sendTransaction({
                to: TARGET_CONTRACT, data: DATA_HEX,
                gasLimit: 850000, 
                maxPriorityFeePerGas: 35000000n, // Aggressive 35 Gwei Priority
                maxFeePerGas: 175000000n, 
                nonce: strikeNonce,
                type: 2, chainId: 8453
            });

            // Post-Strike: Analysis Path (does not slow down the broadcast)
            responsePromise.then(async (response) => {
                const receipt = await response.wait(1);
                if (receipt && receipt.status === 1) {
                    const balanceAfter = await mesh.getBalance(signer.address);
                    const netProfit = balanceAfter - balanceBefore;

                    if (netProfit > 0n) {
                        console.log(`\n${TXT.bold}${TXT.gold}🏆 SETTLEMENT CONFIRMED | BLOCK: ${receipt.blockNumber}${TXT.reset}`);
                        console.log(`${TXT.green}💰 REALIZED PROFIT: +${ethers.formatEther(netProfit)} ETH${TXT.reset}`);
                    } else {
                        console.log(`\n${TXT.bold}${TXT.yellow}📉 MARGIN COMPROMISED | BLOCK: ${receipt.blockNumber}${TXT.reset}`);
                        console.log(`${TXT.red}⚠️ NET YIELD: ${ethers.formatEther(netProfit)} ETH (Gas Intensive)${TXT.reset}`);
                    }
                    console.log(`${TXT.dim}🔗 RECEIPT: https://basescan.org/tx/${receipt.hash}${TXT.reset}\n`);
                }
            }).catch(async (err) => {
                // If nonce error, resync
                if (err.message.includes("nonce")) {
                    nextNonce = await mesh.getTransactionCount(signer.address, 'pending');
                }
            });

        } catch (e) {}
    }

    setInterval(() => seenHashes.clear(), 3600000);
    connect();
}
