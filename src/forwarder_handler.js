const ethers = require("ethers");
const {
  DefenderRelaySigner,
  DefenderRelayProvider,
} = require("defender-relay-client/lib/ethers");

const ForwarderAddress = "0xc82BbE41f2cF04e3a8efA18F7032BDD7f6d98a81";
const speed = "fastest";

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
  permitSignature,
  tokenAmountToApprove
) {
  // Tx args
  const { owner, spender, deadline, v, r, s } = permitSignature;

  // Send meta-tx through relayer to the forwarder contract
  const gasLimit = 100000;
  return await permitContract.permit(
    owner,
    spender,
    tokenAmountToApprove,
    deadline,
    v,
    r,
    s,
    { gasLimit }
  );
}

async function handler(event) {
  // Parse webhook payload
  if (!event.request || !event.request.body) throw new Error(`Missing payload`);
  const { type } = event.request.body;

  console.log("Type", type);

  // Initialize Relayer provider and signer, and forwarder contract
  const credentials = { ...event };
  const provider = new DefenderRelayProvider(credentials);
  const signer = new DefenderRelaySigner(credentials, provider, {
    speed,
  });

  let tx;

  if (type == "permit") {
    // ERC20 Permit
    const { permitSignature, permitContractAddress, tokenAmountToApprove } =
      event.request.body;

    // Initialize permitContract
    const permitContract = new ethers.Contract(
      permitContractAddress,
      erc20PermitAbi,
      signer
    );

    tx = await relayTokenApproval(
      permitContract,
      permitSignature,
      tokenAmountToApprove
    );
  } else if (type == "forward") {
    // Gasless tx
    const { request, signature } = event.request.body;

    // Initialize forwarder contract
    const forwarder = new ethers.Contract(
      ForwarderAddress,
      ForwarderAbi,
      signer
    );

    console.log(`Relaying`, request);
    console.log(`Signature`, signature);

    tx = await relayGeneric(forwarder, request, signature);
  } else {
    throw new Error(
      `Invalid gasless transaction type. Provide type 'permit' or 'forwarder'.`
    );
  }

  console.log(`Sent meta-tx: ${tx.hash}`);
  const receipt = await tx.wait();
  return { txHash: tx.hash, receipt: receipt, txResponse: tx };
}

module.exports = {
  handler,
};
