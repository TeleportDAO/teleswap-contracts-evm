const ethUtil = require('ethereumjs-util');
const Web3 = require('web3');

// Initialize Web3
const web3 = new Web3();

function signMessage(secretKey, message) {
    // Ensure the secret key is in the correct format
    if (!secretKey.startsWith('0x')) {
        secretKey = '0x' + secretKey;
    }

    const messageHex = web3.utils.asciiToHex(message);

    // Hash the message using keccak256
    const messageHash = web3.utils.sha3(messageHex);

    // Ethereum specific message prefix
    const prefix = "\x19Ethereum Signed Message:\n" + messageHex.length;

    // console.log(web3.utils.asciiToHex(prefix) + messageHash.slice(2))

    // const prefixedHash = web3.utils.sha3(web3.utils.asciiToHex(prefix) + messageHash.slice(2));

    prefixedHash = getEthSignedMessageHash(message)

    console.log(prefixedHash)

    // Sign the prefixed message hash
    const signature = ethUtil.ecsign(ethUtil.toBuffer(prefixedHash), ethUtil.toBuffer(secretKey));


    // Derive the Ethereum address from the secret key
    const address = '0x' + ethUtil.privateToAddress(ethUtil.toBuffer(secretKey)).toString('hex');

    // Convert signature parameters to hex format
    const r = '0x' + signature.r.toString('hex');
    const s = '0x' + signature.s.toString('hex');
    const v = signature.v;

    return { messageHex, messageHash, r, s, v, address };
}

function uintToString(num) {
    return num.toString();
}

function getEthSignedMessageHash(message) {
    // Convert the message to a hex string
    const messageHex = web3.utils.asciiToHex(message);

    // Calculate the hash of the message
    const messageHash = ethUtil.keccak256(messageHex);

    // Ethereum specific message prefix
    const prefix = "\x19Ethereum Signed Message:\n" + uintToString(message.length);

    // Combine the prefix and the hash of the message
    const prefixedMessage = ethUtil.toBuffer(prefix).toString('hex') + messageHash.toString('hex');

    // Hash the combined message
    const ethSignedMessageHash = ethUtil.keccak256('0x' + prefixedMessage);

    // return ethSignedMessageHash;
    return '0x' + ethSignedMessageHash.toString('hex');
}

// Example usage
const secretKey = '4c0883a6910297c2d8f2d0b72f27395abf0342c8d5a5e6bd69f5c6da5e448e6a';
const message = 'Hello, blockchain world!';
const result = signMessage(secretKey, message);

console.log('Message Hash:', result.messageHash);
console.log('Signature Components:', result);
