const http = require('http');
const readline = require('readline');

// const Nimiq = require('../../dist/node.js');
const chalk = require('chalk');
const btoa = require('btoa');
const argv = require('minimist')(process.argv.slice(2));

const nativeConsoleError = console.error.bind(console);
console.error = function (error) {
    nativeConsoleError(chalk`{red ${error}}`);
}

let host = '127.0.0.1';
let port = 8648;
let user = null;
let password = null;
if (argv.host) host = argv.host;
if (argv.port) port = parseInt(argv.port);
if (argv.user) {
    user = argv.user;
    const Writable = require('stream').Writable;
    // Hide password in command line.
    const mutableStdout = new Writable({
        write: function(chunk, encoding, callback) {
            if (!this.muted) {
                process.stdout.write(chunk, encoding);
            }
            callback();
        }
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: mutableStdout,
        terminal: true
    });

    mutableStdout.muted = false;
    // Request password.
    rl.question(`Password for ${user}: `, (pw) => {
        password = pw;
        rl.close();
        console.log(''); // Add newline
        main(argv._);
    });
    mutableStdout.muted = true;
} else {
    // Continue without authentication.
    main(argv._);
}

function jsonRpcFetch(method, ...params) {
    return new Promise((resolve, fail) => {
        while (params.length > 0 && typeof params[params.length - 1] === 'undefined') params.pop();
        params = params.map((param, index) => {
            switch (typeof param) {
                case 'number': return method === 'blockByNumber' ? param.toString() : param;
                case 'string':
                    if (param === 'true') return true;
                    if (param === 'false') return false;
                    return param;
                default:
                    return param;
            }
        });
        // console.log('Params:', params);
        const body = JSON.stringify({
            jsonrpc: '2.0',
            id: 42,
            method: method,
            params: params
        });
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
        };
        if (user && password) {
            headers['Authorization'] = `Basic ${btoa(`${user}:${password}`)}`;
        }
        const req = http.request({
            hostname: host,
            port: port,
            method: 'POST',
            headers: headers
        }, (res) => {
            if (res.statusCode === 401) {
                fail(new Error(`Request Failed: Authentication Required. Status Code: ${res.statusCode}`));
                res.resume();
                return;
            }
            if (res.statusCode !== 200) {
                fail(new Error(`Request Failed. ${res.statusMessage? `${res.statusMessage} - `
                    : ''}Status Code: ${res.statusCode}`));
                res.resume();
                return;
            }

            res.setEncoding('utf8');
            let rawData = '';
            res.on('error', fail);
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', () => {
                try {
                    const parse = JSON.parse(rawData);
                    if (parse.error) {
                        fail(`${parse.error.message} - ${parse.error.data}`);
                    } else {
                        resolve(parse.result);
                    }
                } catch (e) {
                    fail(e);
                }
            });
        });
        req.on('error', fail);
        req.write(body);
        req.end();
    });
}

function isTrue(val) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val === 1;
    if (typeof val === 'string') {
        val = val.toLowerCase();
        return val === 'true' || val === 'yes';
    }
    return false;
}

function isFalse(val) {
    if (typeof val === 'boolean') return !val;
    if (typeof val === 'number') return val === 0;
    if (typeof val === 'string') {
        val = val.toLowerCase();
        return val === 'false' || val === 'no';
    }
    return false;
}

function genesisInfo(hash) {
    let chain = 'dev-albatross';
    let color = 'gold';
    // for (const c in Nimiq.GenesisConfig.CONFIGS) {
    //     if (hash === Nimiq.GenesisConfig.CONFIGS[c].GENESIS_BLOCK.hash().toHex()) {
    //         chain = c;
    //         color = 'gold';
    //     }
    // }
    if (chain === 'main') color = 'dodgerblue';
    return {color, chain};
}

function peerAddressStateName(peerState) {
    switch (peerState) {
        case 1:
            return 'New';
        case 2:
            return chalk.green('Established');
        case 3:
            return chalk.yellow('Tried');
        case 4:
            return chalk.yellow('Failed');
        case 5:
            return chalk.red('Banned');
    }
    return 'Unknown';
}

function peerConnectionStateName(connectionState) {
    switch (connectionState) {
        case 1:
            return chalk.yellow('New');
        case 2:
            return chalk.yellow('Connecting');
        case 3:
            return chalk.yellow('Connected');
        case 4:
            return chalk.yellow('Negotiating');
        case 5:
            return chalk.green('Established');
        case 6:
            return chalk.red('Closed');
    }
    return 'Unknown';
}

function accountTypeName(type) {
    switch (type) {
        case 0:
            return 'Basic Account';
        case 1:
            return 'Vesting Contract';
        case 2:
            return 'Hashed Time-Locked Contract';
        case 3:
            return 'Staking Contract';
    }
    return 'Unknown';
}

function bytesFormat(bytes) {
    if (bytes < 2000) return `${bytes} B`;
    if (bytes < 2000000) return `${Math.round(bytes / 100) / 10} kB`;
    if (bytes < 2000000000) return `${Math.round(bytes / 100000) / 10} MB`;
    return `${Math.round(bytes / 1000000)} MB`;
}

function nimValueFormat(value, fixedLength = 0, withSign = false) {
    let valueFirst = ((value > 0 ? Math.floor : Math.ceil)(value / 1000) / 100).toFixed(2);
    if (withSign && value > 0) valueFirst = `+${valueFirst}`;
    valueFirst = new Array(Math.max(0, fixedLength - valueFirst.length)).join(' ') + valueFirst;
    const valueSecond = ((Math.abs(value) % 1000) / 1000).toFixed(3).substring(2);
    return chalk`{bold ${valueFirst}}${valueSecond} NIM`;
}

function approxTimeDifference(diff, withA) {
    diff = Math.abs(diff);
    if (diff < 600) return `${withA ? 'a ' : ''}few minutes`;
    if (diff < 3600) return `${Math.round(diff / 300) * 5} minutes`;
    if (diff < 60 * 60 * 48) return `${Math.round(diff / 3600)} hours`;
    if (diff < 60 * 60 * 24 * 90) return `${Math.round(diff / 86400)} days`;
    if (diff < 60 * 60 * 24 * 600) return `${Math.round(diff / 2592000)} months`;
    return `${Math.round(diff / 32536000)} years`;
}

/**
 * @param {number} blockNumber
 * @param {Block} [head]
 */
function blockNumberFormat(blockNumber, head) {
    if (!head) return blockNumber.toString();
    if (blockNumber === head.number) return `${blockNumber} (Now)`;
    const targetTimestamp = head.timestamp - (head.number - blockNumber) * 0.2 /* BLOCK_TIME */;
    const diff = targetTimestamp - Date.now() / 1000;
    return `${blockNumber} (${diff > 0 ? 'in ' : ''}${approxTimeDifference((head.number - blockNumber) * 0.2 /* BLOCK_TIME */, true)}${diff < 0 ? ' ago' : ''})`;
}

function blockAmountFormat(blocks) {
    return `${blocks} (${approxTimeDifference(blocks * 0.2 /* BLOCK_TIME */)})`;
}

async function displayInfoHeader(width = 0) {
    const genesisBlock = await jsonRpcFetch('blockByNumber', 0, false);
    const blockNumber = await jsonRpcFetch('blockNumber');
    const peerCount = '?'; // await jsonRpcFetch('peerCount');
    const consensus = '?'; // await jsonRpcFetch('consensus');
    const {color, chain} = genesisInfo(genesisBlock.hash);
    //const state = syncing ? `Syncing. [${Math.round(100 * (syncing.currentBlock - syncing.startingBlock) / (syncing.highestBlock - syncing.startingBlock))}%]` : 'On sync.';
    const state = 'Consensus ???'; // consensus === 'established' ? 'Consensus established.' : consensus === 'syncing' ? 'Syncing...' : consensus === 'lost' ? 'Consensus lost.' : 'Unknown state.';
    const descr = chalk`${peerCount} peers | ⛃ ${blockNumber} | ${state}`;
    if (chain !== 'main') {
        const chainPrefix = chalk.keyword('black').bgKeyword(color)(` ${chain} `) + ' ';
        const widthBefore = chain.length + 15 + descr.length;
        const placeHolder = Array(Math.max(0, Math.round((width - widthBefore) / 2))).join(' ');
        console.log(chalk`${placeHolder}${chainPrefix}{keyword("gold") Nimiq} | ${descr}${placeHolder}`);
        if (width <= widthBefore) width = widthBefore + 1;
    } else {
        const widthBefore = descr.length + 8;
        const placeHolder = Array(Math.max(0, Math.round((width - widthBefore) / 2))).join(' ');
        console.log(chalk`${placeHolder}{keyword("gold") Nimiq} | ${descr}${placeHolder}`);
        if (width <= widthBefore) width = widthBefore + 1;
    }
    console.log(Array(width).join('⎺'));
}

function displayBlock(block, hashOrNumber) {
    if (!block) {
        console.log(chalk`Block {bold ${hashOrNumber}} not found.`);
        return;
    }
    console.log(chalk`Block {bold ${block.hash}}:`);
    console.log('-----------------------------------------------------------------------');
    console.log(`Number      | ${block.blockNumber}`);
    console.log(`Type        | ${block.type === 'macro' ? chalk`{bold ${block.type}}` : block.type}`);
    console.log(`Parent-Hash | ${block.parentHash}`);
    console.log(`Timestamp   | ${new Date(block.timestamp).toString()}`);
    console.log(`Epoch       | ${block.epoch}`);
    console.log(`Batch       | ${block.batch}`);
    console.log(`View        | ${block.viewNumber}`);
    console.log('-----------------------------------------------------------------------');
    if (block.type === 'micro') {
        console.log(`Txs Count   | ${block.transactions ? `${block.transactions.length} transaction${block.transactions.length !== 1 ? 's' : ''}` : 'n/a - Pass `true` as a second parameter to receive transaction information'}`);
        console.log(`Producer    | ${block.producer.rewardAddress} (slot ${block.producer.slotNumber})`);
        console.log(`Data        | ${block.extraData || block.extra_data || null}`);
    }
    if (block.type === 'macro') {
        console.log(`Macro-Type  | ${(block.isElectionBlock || block.is_election_block) ? 'Election' : 'Checkpoint'}`);
        console.log(`Votes       | ${block.blockNumber > 0 ? `${block.justification.votes} (${Math.round(block.justification.votes / 342 * 100)}%)` : 'Genesis'}`);
    }
}

async function displayAccount(account, address, head) {
    if (!account) {
        console.log(chalk`Account {bold ${address}} not found.`);
    }
    const type = 'Basic' in account ? 0 : 'Vesting' in account ? 1 : 'HTLC';
    account = account[Object.keys(account)[0]];

    if (!head && type !== 0 /* BASIC */) {
        head = await jsonRpcFetch('blockByNumber', 'latest', false);
    }
    console.log(chalk`Account {bold ${address}}:`);
    console.log(`Type          | ${accountTypeName(type)}`);
    console.log(`Balance       | ${nimValueFormat(account.balance)}`);
    if (type === 1 /* VESTING */) {
        console.log(`Vested amount | ${nimValueFormat(account.vestingTotalAmount)}`);
        console.log(`Vesting start | ${blockNumberFormat(account.vestingStart, head)}`);
        console.log(`Vesting step  | ${nimValueFormat(account.vestingStepAmount)} every ${blockAmountFormat(account.vestingStepBlocks)}`);
        if (account.vestingStart + Math.ceil(account.vestingTotalAmount / account.vestingStepAmount) * account.vestingStepBlocks > head.number) {
            let nextVestingBlockNumber = account.vestingStart + account.vestingStepBlocks;
            while (nextVestingBlockNumber < head.number) nextVestingBlockNumber += account.vestingStepBlocks;
            const nextVestingAmount = Math.min(account.vestingStepAmount, account.vestingTotalAmount - Math.floor((head.number - account.vestingStart) / account.vestingStepBlocks) * account.vestingStepAmount);
            console.log(`Next vesting  | ${nimValueFormat(nextVestingAmount)} at ${blockNumberFormat(nextVestingBlockNumber, head)}`);
        } else {
            console.log(chalk`Next vesting  | {italic Fully vested}`);
        }
    } else if (type === 2 /* HTLC */) {
        console.log(`Sender        | ${account.senderAddress}`);
        console.log(`Recipient     | ${account.recipientAddress}`);
        console.log(`Locked amount | ${nimValueFormat(account.totalAmount)}`);
        console.log(`Timeout       | ${blockNumberFormat(account.timeout, head)}`);
        console.log(`Hash depth    | ${account.hashCount}`);
        console.log(`Hash root     | ${account.hashRoot}`);
    }
}

async function displayTransaction(transaction, hashOrNumber, index, beforeSend) {
    if (!transaction) {
        if (typeof index !== 'undefined') {
            console.log(chalk`Block {bold ${hashOrNumber}} not found or has less than {bold ${index - 1}} transactions.`);
        } else {
            console.log(chalk`Transaction {bold ${hashOrNumber}} not found.`);
        }
        return;
    }
    let block = null;
    if (transaction.blockHash) block = await jsonRpcFetch('blockByHash', transaction.blockHash);
    if (!beforeSend) {
        console.log(chalk`Transaction {bold ${transaction.transactionHash}}:`);
    } else {
        console.log(chalk`Transaction to send:`);
    }
    console.log(`From          | ${transaction.from}`);
    console.log(`To            | ${transaction.to}`);
    if (block) {
        console.log(`Timestamp     | ${new Date(block.timestamp * 1000).toString()}`);
    } else if (!beforeSend) {
        console.log(chalk`Timestamp     | {italic Pending...}`);
    }
    console.log(`Amount        | ${nimValueFormat(transaction.value)}`);
    console.log(`Fee           | ${nimValueFormat(transaction.fee)}`);
    console.log(`Data          | ${transaction.data}`);
    if (block) {
        console.log(`In block      | ${block.number} (index ${transaction.transactionIndex})`);
        console.log(`Confirmations | ${transaction.confirmations}`);
    } else if (!beforeSend) {
        console.log(chalk`In block      | {italic Pending...}`);
        console.log('Confirmations | 0');
    }
}

function displayPeerState(peerState, desc) {
    if (!peerState) {
        console.log(chalk`Peer {bold ${desc}} not found.`);
        return;
    }
    console.log(chalk`Peer {bold ${peerState.id}}:`);
    console.log(`Address         | ${peerState.address}`);
    console.log(`Failed attempts | ${peerState.failedAttempts}`);
    console.log(`A-State         | ${peerAddressStateName(peerState.addressState)}`);
    if (peerState.connectionState) {
        console.log(`C-State         | ${peerConnectionStateName(peerState.connectionState)}`);
        console.log(`Head hash       | ${peerState.headHash}`);
        console.log(`Time offset     | ${peerState.timeOffset}`);
        console.log(`Latency         | ${peerState.latency}`);
        console.log(`Traffic         | ${bytesFormat(peerState.rx)} RX / ${bytesFormat(peerState.tx)} TX`);
    } else {
        console.log('C-State         | Disconnected');
    }
}

function formatMonth(month) {
    return ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][month] || '???';
}

async function action(args, rl) {
    switch (args[0]) {
        // Accounts
        case 'accounts': {
            if (!rl && !argv.silent) {
                await displayInfoHeader(68);
            }
            const addresses = await jsonRpcFetch('listAccounts');
            const accounts = addresses.map(address => ({ address }));
            accounts.sort((a, b) => a.address > b.address ? 1 : -1);
            for (const account of accounts) {
                const raw = await jsonRpcFetch('getAccount', account.address);
                account.balance = raw.Basic.balance;
                console.log(`${account.address} | ${nimValueFormat(account.balance, 14)}`);
            }
            return;
        }
        case 'accounts.json': {
            const addresses = await jsonRpcFetch('listAccounts');
            const accounts = addresses.map(address => ({ address }));
            for (const account of accounts) {
                const raw = await jsonRpcFetch('getAccount', account.address);
                account.balance = raw.Basic.balance;
            }
            console.log(JSON.stringify(accounts));
            return;
        }
        case 'account': {
            if (!rl && !argv.silent) {
                await displayInfoHeader(81);
            }
            if (args.length === 2) {
                await displayAccount(await jsonRpcFetch('getAccount', args[1]), args[1]);
                return;
            }
            console.error('Specify account address');
            return;
        }
        case 'account.json': {
            if (args.length === 2) {
                console.log(JSON.stringify(await jsonRpcFetch('getAccount', args[1])));
                return;
            }
            console.error('Specify account address');
            return;
        }
        case 'account.import': {
            if (rl && !args[2]) {
                args[2] = (await new Promise(resolve => { rl.question('Password? (none)', resolve); }));
            }
            const account = await jsonRpcFetch('importRawKey', args[1], args[2] || null);
            console.dir(account);
            return;
        }
        case 'account.create': {
            if (rl && !args[1]) {
                args[1] = (await new Promise(resolve => { rl.question('Password? (none)', resolve); }));
            }
            const account = await jsonRpcFetch('createAccount', args[1] || null);
            console.dir(account);
            return;
        }
        case 'account.unlock': {
            if (rl && !args[2]) {
                args[2] = (await new Promise(resolve => { rl.question('Password? (none)', resolve); }));
            }
            const account = await jsonRpcFetch('unlockAccount', args[1], args[2] || null, /* duration */ null);
            console.dir(account);
            return;
        }

        // Blocks
        case 'block': {
            if (!rl && !argv.silent) {
                await displayInfoHeader(79);
            }
            if (rl && !args[1]) {
                // Ask for options
                args[1] = (await new Promise(resolve => { rl.question('Block hash or number? (latest)', resolve); })) || 'latest';
            }
            if (args.length === 2 || args.length === 3) {
                if (args[1].length === 64 || args[1].length === 44) {
                    displayBlock(await jsonRpcFetch('blockByHash', args[1], args[2] || false), args[1]);
                    return;
                } else if (args[1] === 'latest' || /^(latest-)?[0-9]*$/.test(args[1])) {
                    displayBlock(await jsonRpcFetch('blockByNumber', args[1], args[2] || false), args[1]);
                    return;
                }
            }
            console.error('Specify block number, block hash or \'latest\'');
            return;
        }
        case 'block.raw': {
            if (args.length === 2 || args.length === 3) {
                if (args[1].length === 64 || args[1].length === 44) {
                    console.dir(await jsonRpcFetch('blockByHash', args[1], args[2] || false), args[1]);
                    return;
                } else if (args[1] === 'latest' || /^(latest-)?[0-9]*$/.test(args[1])) {
                    console.dir(await jsonRpcFetch('blockByNumber', args[1], args[2] || false), args[1]);
                    return;
                }
            }
            console.error('Specify block number, block hash or \'latest\'');
            return;
        }
        case 'block.json': {
            if (args.length === 2 || args.length === 3) {
                if (args[1].length === 64 || args[1].length === 44) {
                    console.log(JSON.stringify(await jsonRpcFetch('blockByHash', args[1], args[2] || false)));
                    return;
                } else if (args[1] === 'latest' || /^(latest-)?[0-9]*$/.test(args[1])) {
                    console.log(JSON.stringify(await jsonRpcFetch('blockByNumber', args[1], args[2] || false)));
                    return;
                }
            }
            console.log(JSON.stringify(null));
            return;
        }
        // Transactions
        case 'transaction': {
            if (!rl && !argv.silent) {
                await displayInfoHeader(79);
            }
            if (rl && !args[1]) {
                // Ask for options
                args[1] = await new Promise(resolve => { rl.question('Transaction hash? ', resolve); });
            }
            if (args.length === 2) {
                await displayTransaction(await jsonRpcFetch('getTransactionByHash', args[1]), args[1]);
                return;
            // } else if (args.length === 3) {
            //     if (args[1].length === 64 || args[1].length === 44) {
            //         await displayTransaction(await jsonRpcFetch('getTransactionByBlockHashAndIndex', args[1], args[2]), args[1], args[2]);
            //         return;
            //     } else if (args[1] === 'latest' || /^(latest-)?[0-9]*$/.test(args[1])) {
            //         await displayTransaction(await jsonRpcFetch('getTransactionByBlockNumberAndIndex', args[1], args[2]), args[1], args[2]);
            //         return;
            //     }
            }
            console.error('Specify transaction hash');
            // console.error('Specify transaction hash or block identifier (block number, block hash or \'latest\') and transaction index');
            return;
        }
        case 'transaction.json': {
            if (args.length === 2) {
                console.log(JSON.stringify(await jsonRpcFetch('getTransactionByHash', args[1])));
                return;
            } else if (args.length === 3) {
                if (args[1].length === 64 || args[1].length === 44) {
                    console.log(JSON.stringify(await jsonRpcFetch('getTransactionByBlockHashAndIndex', args[1], args[2])));
                    return;
                } else if (args[1] === 'latest' || /^(latest-)?[0-9]*$/.test(args[1])) {
                    console.log(JSON.stringify(await jsonRpcFetch('getTransactionByBlockNumberAndIndex', args[1], args[2])));
                    return;
                }
            }
            console.log(JSON.stringify(null));
            return;
        }
        case 'transaction.send': {
            // if (!rl && !argv.silent) {
            //     await displayInfoHeader(74);
            // }
            if (rl && args.length === 1) {
                // Ask for options
                args[1] = await new Promise(resolve => { rl.question('From address? ', resolve); });
                args[2] = await new Promise(resolve => { rl.question('To address? ', resolve); });
                args[3] = await new Promise(resolve => { rl.question('Value [NIM]? ', resolve); });
                args[4] = (await new Promise(resolve => { rl.question('Fee [NIM]? (0) ', resolve); })) || 0;
            }
            if (args.length < 4 || args.length > 5) {
                console.error('Arguments for \'transaction.send\': from, to, value[, fee]');
                return;
            }
            const from = args[1];
            const to = args[2];
            const value = Math.floor(parseFloat(args[3]) * 1e5);
            const fee = args.length > 4 ? Math.floor(parseFloat(args[4]) * 1e5) : 0;
            const data = args.length > 5 ? args[5] : undefined;
            displayTransaction({from, to, value, fee, data: data || null}, undefined, undefined, true);
            let answer;
            if (rl) {
                answer = await new Promise((resolve) => {
                    rl.question('Are you sure you want to send this transaction? (y/N) ', resolve);
                });
            } else {
                // For backwards compatible use in scripts, assume yes here.
                answer = 'y';
            }
            if (answer.toLowerCase() === 'y') {
                const hash = await jsonRpcFetch('sendBasicTransaction', from, to, value, fee, '+0');
                console.log(chalk`Sent as {bold ${hash}}.`);
            } else {
                console.log(chalk`Transaction was {bold not} sent.`);
            }
            return;
        }
        case 'transaction.receipt': {
            if (!rl && !argv.silent) {
                await displayInfoHeader(74);
            }
            if (rl && !args[1]) {
                // Ask for options
                args[1] = await new Promise(resolve => { rl.question('Transaction hash? ', resolve); });
            }
            if (args.length !== 2) {
                console.error('Specify transaction hash');
                return;
            }
            const receipt = await jsonRpcFetch('getTransactionReceipt', args[1]);
            if (!receipt) {
                console.log('Transaction not yet confirmed');
            } else {
                console.log(chalk`Receipt {bold ${receipt.transactionHash}}:`);
                console.log(`In block      | ${receipt.blockNumber} (at index ${receipt.transactionIndex})`);
                if (receipt.timestamp) console.log(`Timestamp     | ${new Date(receipt.timestamp * 1000).toString()}`);
                console.log(`Confirmations | ${receipt.confirmations}`);
            }
            return;
        }
        case 'transaction.receipt.json': {
            if (args.length !== 2) {
                console.error('Specify transaction hash');
                return;
            }
            console.log(JSON.stringify(await jsonRpcFetch('getTransactionReceipt', args[1])));
            return;
        }
        case 'transactions': {
            console.error('blockchain.get_transaction_receipts_by_address() not defined in core-rs-albatross');
            return;

            if (rl && !args[1]) {
                // Ask for options
                args[1] = await new Promise(resolve => { rl.question('Address? ', resolve); });
            }
            if (args.length < 2) {
                console.error('Specify account address');
                return;
            }
            if (!rl && !argv.silent) {
                await displayInfoHeader(75);
            }
            const transactions = (await jsonRpcFetch('getTransactionsByAddress', args[1], args[2])).sort((a, b) => a.timestamp > b.timestamp);
            const self = Nimiq.Address.fromString(args[1]);
            console.log(chalk`Transaction log for {bold ${self.toUserFriendlyAddress()}}:`);
            for (const tx of transactions) {
                const sent = self.toHex() === tx.from;
                const dir = sent ? '  to' : 'from';
                const other = sent ? tx.toAddress : tx.fromAddress;
                const date = new Date(tx.timestamp * 1000);
                const value = sent ? -(tx.value + tx.fee) : tx.value;
                let dateStr = date.getDate().toString();
                if (dateStr.length === 1) {
                    dateStr = ` ${dateStr} `;
                } else {
                    dateStr = `${dateStr[0]}${dateStr[1]} `;
                }
                console.log(chalk`${dateStr} | ${dir} ${other} | {${sent ? 'red' : 'green'} ${nimValueFormat(value, 10, true)}}`);
                console.log(`${formatMonth(date.getMonth())} | ID: ${tx.hash}`);
            }
            return;
        }
        case 'transactions.json': {
            console.error('blockchain.get_transaction_receipts_by_address() not defined in core-rs-albatross');
            return;

            if (args.length < 2) {
                console.error('Specify account address');
                return;
            }
            console.log(JSON.stringify(await jsonRpcFetch('getTransactionsByAddress', args[1], args[2])));
            return;
        }
        case 'mempool': {
            const mempoolStats = await jsonRpcFetch('mempool');
            console.log(chalk`Mempool stats: ({bold ${mempoolStats.total}} transactions):`);
            if (!mempoolStats.buckets.length) return;
            console.log('By fee per byte:');
            for (let i = 0; i < mempoolStats.buckets.length; i++) {
                const bucket = mempoolStats.buckets[i];
                const count = mempoolStats[bucket];
                if (i === 0) {
                    console.log(`> ${bucket}:\t${count} transactions`);
                } else {
                    console.log(`${bucket}-${mempoolStats.buckets[i-1]}:\t${count} transactions`);
                }
            }
            return;
        }
        case 'mempool.content': {
            const includeTransactions = args.length === 2 && isTrue(args[1]);
            const transactions = await jsonRpcFetch('mempoolContent', includeTransactions);
            console.log(chalk`Mempool content ({bold ${transactions.length}} transactions):`);
            for (const tx of transactions) {
                if (includeTransactions) {
                    console.log(`ID: ${tx.transactionHash} | ${tx.from} -> ${tx.to} | ${nimValueFormat(tx.value, 10)} | ${nimValueFormat(tx.fee, 10)}`);
                } else {
                    console.log(tx);
                }
            }
            return;
        }
        case 'mempool.content.json': {
            const includeTransactions = args.length === 2 && isTrue(args[1]);
            console.log(JSON.stringify(await jsonRpcFetch('mempoolContent', includeTransactions)));
            return;
        }
        // case 'consensus.min_fee_per_byte': {
        //     console.log(await jsonRpcFetch('minFeePerByte', args[1]));
        //     return;
        // }
        // case 'constant': {
        //     if (args.length < 2) {
        //         console.error('Specify constant name');
        //         return;
        //     }
        //     console.log(await jsonRpcFetch('constant', args[1], args.length === 3 ? args[2] : undefined));
        //     return;
        // }
        // case 'peers': {
        //     const peerList = (await jsonRpcFetch('peerList')).sort((a, b) => a.addressState === 2 ? -1 : b.addressState === 2 ? 1 : a.addressState < b.addressState ? 1 : a.addressState > b.addressState ? -1 : a.address > b.address);
        //     const maxAddrLength = peerList.map(p => p.address.length).reduce((a, b) => Math.max(a, b), 0);
        //     if (!rl) {
        //         await displayInfoHeader(maxAddrLength + 15);
        //     }
        //     for (const peer of peerList) {
        //         const space = Array(maxAddrLength - peer.address.length + 1).join(' ');
        //         console.log(chalk`${peer.address}${space} | ${peer.connectionState ? peerConnectionStateName(peer.connectionState) : peerAddressStateName(peer.addressState)}`);
        //     }
        //     return;
        // }
        // case 'peers.raw': {
        //     console.dir(await jsonRpcFetch('peerList'));
        //     return;
        // }
        // case 'peers.json': {
        //     console.log(JSON.stringify(await jsonRpcFetch('peerList')));
        //     return;
        // }
        // case 'peer': {
        //     if (rl && !args[1]) {
        //         // Ask for options
        //         args[1] = await new Promise(resolve => { rl.question('Peer URI? ', resolve); });
        //     }
        //     if (args.length < 2) {
        //         console.error('Specify peer URI');
        //         return;
        //     }
        //     const peerState = await jsonRpcFetch('peerState', args[1], args.length > 2 ? args[2] : undefined);
        //     if (!rl) {
        //         await displayInfoHeader((peerState ? peerState.address.length : 0) + 20);
        //     }
        //     displayPeerState(peerState, args[1]);
        //     return;
        // }
        // case 'peer.raw': {
        //     if (args.length < 2) {
        //         console.error('Specify peer URI');
        //         return;
        //     }
        //     console.dir(await jsonRpcFetch('peerState', args[1], args.length > 2 ? args[2] : undefined));
        //     return;
        // }
        // case 'peer.json': {
        //     if (args.length < 2) {
        //         console.error('Specify peer URI');
        //         return;
        //     }
        //     console.log(JSON.stringify(await jsonRpcFetch('peerState', args[1], args.length > 2 ? args[2] : undefined)));
        //     return;
        // }
        // Staking
        case 'stakes': {
            if (!rl && !argv.silent) {
                await displayInfoHeader();
            }
            const stakes = await jsonRpcFetch('listStakes');

            console.log(chalk`{bold Active Validators}`);
            stakes.activeValidators.sort((a, b) => a.rewardAddress > b.rewardAddress ? 1 : -1);
            for (const validator of stakes.activeValidators) {
                console.log(`${validator.id} | ${validator.rewardAddress} | ${nimValueFormat(validator.balance, 14)} | ${Object.keys(validator.stakes).length} delegates`);
            }

            console.log(chalk`{bold Inactive Validators}`);
            for (const { validator } of stakes.inactiveValidators) {
                console.log(chalk`{gray ${validator.id} | ${validator.rewardAddress} | ${nimValueFormat(validator.balance, 14)} | ${Object.keys(validator.stakes).length} delegates}`);
            }

            console.log(chalk`{bold Inactive Stakes}`);
            for (const stake of stakes.inactiveStakes) {
                console.log(chalk`{gray ${stake.stakerAddress} | ${nimValueFormat(stake.balance, 14)}}`);
            }
            return;
        }
        case 'stakes.raw': {
            console.dir(await jsonRpcFetch('listStakes'), {depth: Infinity});
            return;
        }
        case 'stakes.json': {
            console.log(JSON.stringify(await jsonRpcFetch('listStakes'), {depth: Infinity}));
            return;
        }
        case 'stakes.account': {
            if (!rl && !argv.silent) {
                await displayInfoHeader(0);
            }
            if (rl && !args[1]) {
                // Ask for options
                args[1] = await new Promise(resolve => { rl.question('Staking address? ', resolve); });
            }
            if (args.length < 2) {
                console.error('Specify staking address');
                return;
            }
            const address = args[1].toUpperCase().replace(/\s/g, '').replace(/.{4}/g, '$& ').trim();
            if (address.substring(0, 2) !== 'NQ' || address.length !== 44) {
                console.error('Specify the address in userfriendly format (NQ-format)');
                return;
            }
            const stakes = await jsonRpcFetch('listStakes');

            // Collect data
            const activeValidators = stakes.activeValidators
                .filter(validator => validator.rewardAddress === address)
                .reduce((summary, validator) => ({
                    balance: summary.balance + validator.balance,
                    stakeCount: summary.stakeCount + Object.keys(validator.stakes).length,
                    validatorCount: summary.validatorCount + 1,
                }), { balance: 0, stakeCount: 0, validatorCount: 0 });
            const activeDelegatedStakes = stakes.activeValidators.map(validator => {
                if (validator.rewardAddress === address) return null;
                const amount = validator.stakes[address];
                if (amount) return { rewardAddress: validator.rewardAddress, amount };
                return null;
            }).filter(obj => Boolean(obj));
            const activeDelegatedStakeSum = activeDelegatedStakes.reduce((sum, stake) => sum + stake.amount, 0);

            const inactiveValidators = stakes.inactiveValidators
                .filter(validator => validator.rewardAddress === address)
                .reduce((summary, validator) => ({
                    balance: summary.balance + validator.balance,
                    stakeCount: summary.stakeCount + Object.keys(validator.stakes).length,
                    validatorCount: summary.validatorCount + 1,
                }), { balance: 0, stakeCount: 0, validatorCount: 0 });
            const inactiveDelegatedStakes = stakes.inactiveValidators.map(({validator}) => {
                if (validator.rewardAddress === address) return null;
                const amount = validator.stakes[address];
                if (amount) return { rewardAddress: validator.rewardAddress, amount };
                return null;
            }).filter(obj => Boolean(obj));
            const inactiveDelegatedStakeSum = inactiveDelegatedStakes.reduce((sum, stake) => sum + stake.amount, 0);

            const inactiveStake = stakes.inactiveStakes.find(stake => stake.stakerAddress === address);

            // Output
            if (activeValidators.validatorCount) {
                console.log(chalk`\n{bold Active Validators (${activeValidators.validatorCount})} ${nimValueFormat(activeValidators.balance, 40 - activeValidators.validatorCount.toString().length)} | ${activeValidators.stakeCount} delegates`);
            }
            console.log(chalk`\n{bold Active Delegated Stake} (${nimValueFormat(activeDelegatedStakeSum)}):`);
            for (const stake of activeDelegatedStakes) {
                console.log(`${stake.rewardAddress} | ${nimValueFormat(stake.amount, 14)}`);
            }
            if (!activeDelegatedStakes.length) console.log('- none -');

            if (inactiveValidators.validatorCount) {
                console.log(chalk`\n{gray Inactive Validators (${inactiveValidators.validatorCount}) ${nimValueFormat(inactiveValidators.balance, 38 - inactiveValidators.validatorCount.toString().length)} | ${inactiveValidators.stakeCount} delegates}`);
            }
            if (inactiveDelegatedStakeSum) {
                console.log(chalk`\n{gray Inactive Delegated Stake (${nimValueFormat(inactiveDelegatedStakeSum)}):}`);
                for (const stake of inactiveDelegatedStakes) {
                    console.log(chalk`{gray ${stake.rewardAddress} | ${nimValueFormat(stake.amount, 14)}}`);
                }
            }

            if (inactiveStake) {
                console.log(chalk`\n{gray Inactive Stake: ${nimValueFormat(inactiveStake.balance, 45)}}`);
            }
            return;
        }
        case 'validator': {
            console.error('Not implemented');
            return;
        }
        // Other
        case 'default': {
            try {
                await displayInfoHeader(43);
            } catch (e) {
                console.error(e);
            }
            console.log('Use `help` command for usage instructions.');
            return;
        }
        case 'status': {
            try {
                await displayInfoHeader(79);
            } catch (e) {
                console.error(e);
            }
            return;
        }
        // case 'log': {
        //     if (args.length < 2) {
        //         args.push('verbose');
        //     }
        //     if (args.length < 3) {
        //         args.splice(1, 0, '*');
        //     }
        //     if (args.length > 3) {
        //         console.error('Too many args');
        //         return;
        //     }
        //     // args[2] = Nimiq.Log.Level.toString(Nimiq.Log.Level.get(args[2]));
        //     JSON.stringify(await jsonRpcFetch('log', args[1], args[2]));
        //     if (args[1] === '*') {
        //         console.log(`Global log level set to ${args[2]}`);
        //     } else {
        //         console.log(`Log level for tag ${args[1]} set to ${args[2]}`);
        //     }
        //     return;
        // }
        case 'help':
            console.log(`Actions:
    status                  Display the current status of the Nimiq node.
    accounts                List local accounts.
    account ADDR            Display details for account with address ADDR.
    account.import PRIVATE_KEY [PASSWORD]
                            Import a Nimiq Account from its private key and
                            store it in the WalletStore of the Nimiq node.
    account.create [PASSWORD]
                            Create a new Nimiq Account and store it in the
                            WalletStore of the Nimiq node.
    account.unlock [PASSWORD]
                            Unlock an account in the WalletStore of the
                            Nimiq node.
    block BLOCK             Display details of block BLOCK.
    mempool                 Display mempool stats.
    mempool.content [INCLUDE_TX]
                            Display mempool content. If INCLUDE_TX is given,
                            full transactions instead of transaction hashes
                            are requested.
    peers                   List all known peer addresses and their current
                            connection state.
    peer PEER [ACTION]      Display details about peer PEER. If ACTION is
                            specified, invokes the named action on the peer.
                            Currently supported actions include:
                            connect, disconnect, ban, unban, fail
    stakes                  Display list of all validators, both active and
                            inactive, and inactive stakes in the network.
    stakes.account ADDR     Display staking status of address ADDR.
    transaction TX          Display details about transaction TX.
    transaction BLOCK IDX   Display details about transaction at index IDX in
                            block BLOCK.
    transaction.receipt TX  Display the transaction receipt for transaction TX.
    transaction.send SENDER RECIPIENT VALUE [FEE]
                            Create, sign and send a transaction with the given
                            properties. The sending account must be a local
                            account.
    transactions ADDR [LIMIT]
                            Display at most LIMIT transactions involving address ADDR.
    constant CONST [VAL]    Display value of constant CONST. If VAL is given,
                            overrides constant const with value VAL.
    consensus.min_fee_per_byte [FEE]
                            Read or change the current min fee per byte setting.
    help                    Display this help.
    log [LEVEL] [TAG]       Set the log level for TAG to LEVEL. If LEVEL is
                            omitted, 'verbose' is assumed. If TAG is omitted,
                            '*' is assumed.


Most actions support output either in human-readable text form (default) or as
JSON by appending '.json' to the action name. Addresses may be given in user-
friendly address format, hex or base64 encoded. Blocks can be specified by hash
in hex or base64 format or by the height on the main chain. Transactions are
understood in hex or base64 format of their hash.`);
            return;
        case 'raw':
            // args = args.map(arg => {
            //     if (parseInt(arg, 10).toString() === arg) {
            //         return parseInt(arg, 10);
            //     } else {
            //         return arg;
            //     }
            // });
            args.shift(); // Remove 'raw' from the front
            console.dir(await jsonRpcFetch(...args), {depth: Infinity});
            return;
        default:
            if (rl) {
                console.log(rl);
                console.error('Unknown command. Use `help` command for usage instructions.');
                return;
            }

            if (!rl) {
                console.log(`Nimiq NodeJS JSON-RPC-Client

Usage:
    node remote.js [options] action [args]

Options:
    --host HOST             Define hostname or IP address of Nimiq JSON-RPC
                            server to connect to. Defaults to local host.
    --port PORT             Define port corresponding to HOST.
                            Defaults to 8648.
    --user USER             Use basic authentication with username USER.
                            The password will be prompted for.

`);
            }
    }
}

function main(args) {
    if (!args || args.length === 0) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            removeHistoryDuplicates: true,
            completer: function (line, callback) {
                if (line.indexOf(' ') < 0) {
                    const completions = ['status', 'account', 'account.json', 'accounts', 'accounts.json', 'accounts.create',
                        'block', 'block.json', 'constant', 'mining', 'mining.json', 'mining.enabled', 'mining.threads',
                        'mining.hashrate', 'mining.address', 'mining.poolConnection', 'mining.poolBalance',
                        'mining.pool', 'peer', 'peer.json', 'peers', 'peers.json', 'transaction', 'transaction.json',
                        'transaction.receipt', 'transaction.receipt.json', 'transaction.send', 'transactions',
                        'transactions.json', 'mempool', 'mempool.content', 'mempool.content.json',
                        'consensus.min_fee_per_byte', 'log', 'help'];
                    const hits = completions.filter((c) => c.startsWith(line));
                    callback(null, [hits.length ? hits : completions, line]);
                } else {
                    callback(null, []);
                }
            }
        });
        rl.on('line', async (line) => {
            line = line.trim();
            if (line === 'exit') {
                rl.close();
                return;
            }
            let args = [];
            while (line) {
                if (line[0] === '\'' || line[0] === '"') {
                    const close = line.indexOf(line[0], 1);
                    if (close < 0 || (line.length !== close + 1 && line[close + 1] !== ' ')) {
                        console.log('Invalid quoting');
                        line = null;
                        args = null;
                        break;
                    }
                    args.push(line.substring(1, close));
                    line = line.substring(close + 1).trim();
                } else {
                    let close = line.indexOf(' ');
                    if (close < 0) close = line.length;
                    args.push(line.substring(0, close));
                    line = line.substring(close + 1).trim();
                }
            }
            if (args !== null && args.length > 0) {
                try {
                    await action(args, rl);
                } catch (e) {
                    console.error(e);
                }
            }
            rl.prompt();
        });
        rl.on('close', () => {
            process.exit(0);
        });
        displayInfoHeader(79).then(() => rl.prompt()).catch((error) => {
            console.log(`Could not connect to Nimiq NodeJS client via RPC on ${host}:${port}.`);
            if (error.message) {
                console.log(error.message);
            }
            console.log('Use `help` command for usage instructions.');
            rl.close();
        });
    } else {
        action(args, false).catch(console.error);
    }
}
