const ethers = require("ethers");
const {
  DefenderRelaySigner,
  DefenderRelayProvider,
} = require("defender-relay-client/lib/ethers");

// An allowlist for contract that's allowed for gasless transactions
// You should replace this with your own contract address. Leave it empty to allow all contracts
// NOTE: Make sure the addresses are in lowercase.
const ALLOWED_TARGET_CONTRACT_ADDRESSES = [];

// An allowlist for allowed forwarder contract (See README)
// You should replace this with your own trusted fowarder address. Leave it empty to allow all forwarder
// NOTE: Make sure the addresses are in lowercase. ForwarderEOA address is not included
const ALLOWED_FORWARDER_ADDRESSES = [
  "0xc82bbe41f2cf04e3a8efa18f7032bdd7f6d98a81",
  "0x8cbc8b5d71702032904750a66aefe8b603ebc538", // arbitrum goerli, optimism goerli, binance testnet, bsc mainnet
  "0x5001a14ca6163143316a7c614e30e6041033ac20", // goerli
];

const TRANSACTION_SPEED = "fastest";

const ForwarderAbi = [
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" },
          { internalType: "uint256", name: "gas", type: "uint256" },
          { internalType: "uint256", name: "nonce", type: "uint256" },
          { internalType: "bytes", name: "data", type: "bytes" },
        ],
        internalType: "struct MinimalForwarder.ForwardRequest",
        name: "req",
        type: "tuple",
      },
      { internalType: "bytes", name: "signature", type: "bytes" },
    ],
    name: "execute",
    outputs: [
      { internalType: "bool", name: "", type: "bool" },
      { internalType: "bytes", name: "", type: "bytes" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "from", type: "address" }],
    name: "getNonce",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "from", type: "address" },
          { internalType: "address", name: "to", type: "address" },
          { internalType: "uint256", name: "value", type: "uint256" },
          { internalType: "uint256", name: "gas", type: "uint256" },
          { internalType: "uint256", name: "nonce", type: "uint256" },
          { internalType: "bytes", name: "data", type: "bytes" },
        ],
        internalType: "struct MinimalForwarder.ForwardRequest",
        name: "req",
        type: "tuple",
      },
      { internalType: "bytes", name: "signature", type: "bytes" },
    ],
    name: "verify",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
];

const erc20PermitAbi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "owner",
        type: "address",
      },
      {
        internalType: "address",
        name: "spender",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "value",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "deadline",
        type: "uint256",
      },
      {
        internalType: "uint8",
        name: "v",
        type: "uint8",
      },
      {
        internalType: "bytes32",
        name: "r",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "s",
        type: "bytes32",
      },
    ],
    name: "permit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

async function relayGeneric(forwarder, request, signature) {
  // Validate request on the forwarder contract
  const valid = await forwarder.verify(request, signature);
  if (!valid) throw new Error(`Invalid request`);

  // Send meta-tx through relayer to the forwarder contract
  const gasLimit = (parseInt(request.gas) + 50000).toString();
  return await forwarder.execute(request, signature, { gasLimit });
}

async function relayTokenApproval(
  permitContract,
  permitMessage,
  permitSignature
) {
  // Tx args
  const { owner, spender, value, deadline, v, r, s } = permitMessage;

  // Send meta-tx through relayer to the forwarder contract
  return await permitContract.permit(owner, spender, value, deadline, v, r, s);
}

async function handler(event) {
  // Parse webhook payload
  if (!event.request || !event.request.body) throw new Error(`Missing payload`);
  const { request, signature, type } = event.request.body;

  console.log("Request Body:", event.request.body);

  // Initialize Relayer provider and signer, and forwarder contract
  const credentials = { ...event };
  const provider = new DefenderRelayProvider(credentials);
  const signer = new DefenderRelaySigner(credentials, provider, {
    TRANSACTION_SPEED,
  });

  let tx;

  const targetContractAddress = request.to || "";

  if (
    ALLOWED_TARGET_CONTRACT_ADDRESSES.length > 0 &&
    !ALLOWED_TARGET_CONTRACT_ADDRESSES.includes(
      targetContractAddress.toLowerCase()
    )
  ) {
    throw new Error("Invalid target address");
  }

  if (type == "permit") {
    // ERC20 Permit

    // Initialize permitContract
    const permitContract = new ethers.Contract(
      request.to,
      erc20PermitAbi,
      signer
    );

    tx = await relayTokenApproval(permitContract, request, signature);
  } else if (type == "forward") {
    // Gasless tx
    const { forwarderAddress } = event.request.body;

    if (
      ALLOWED_FORWARDER_ADDRESSES.length > 0 &&
      !ALLOWED_FORWARDER_ADDRESSES.includes(forwarderAddress.toLowerCase())
    ) {
      throw new Error("Invalid forwarder address");
    }

    console.log(`Relaying`, request);
    console.log(`Signature`, signature);

    // fix ledger live where signature result in v = 0, 1.
    const fixedSig = ethers.utils.joinSignature(
      ethers.utils.splitSignature(signature)
    );

    console.log(`Fixed Signature`, fixedSig);

    // Initialize forwarder contract
    const forwarderContract = new ethers.Contract(
      forwarderAddress,
      ForwarderAbi,
      signer
    );

    tx = await relayGeneric(forwarderContract, request, fixedSig);
  } else {
    throw new Error(
      `Invalid gasless transaction type. Provide type 'permit' or 'forward'.`
    );
  }

  console.log(`Sent meta-tx: ${tx.hash}`);
  return { txHash: tx.hash, txResponse: tx };
}

module.exports = {
  handler,
};
