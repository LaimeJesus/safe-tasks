import { populateExecuteTx, signHash } from "@gnosis.pm/safe-contracts"
import { BigNumber, PopulatedTransaction } from "ethers"
import { task, types } from "hardhat/config"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { safeSingleton } from "../contracts"
import { calcSafeTxHash, loadMetaTransactions, loadSignatures, parseMultiSendJsonFile, prepareSignatures, proposalFile, readFromCliCache, SafeTxProposal, updateSignatureFile, writeToCliCache } from "../execution/utils"

const createProposal = async (taskArgs: any, hre: HardhatRuntimeEnvironment) => {
    console.log(`Running on ${hre.network.name}`)
    const safe = await safeSingleton(hre, taskArgs.address)
    const safeAddress = await safe.resolvedAddress
    console.log(`Using Safe at ${safeAddress}`)
    const _nonce = await safe.nonce()
    const nonce = BigNumber.from(_nonce).toNumber()
    const txs = await loadMetaTransactions(taskArgs.txsFile)
    const chainId = (await safe.provider.getNetwork()).chainId
    const tx = await parseMultiSendJsonFile(hre, txs, nonce, taskArgs.multiSend)
    console.log("Safe transaction", tx)
    const safeTxHash = await calcSafeTxHash(safe, tx, chainId, taskArgs.onChainHash)
    const proposal: SafeTxProposal = {
        safe: safeAddress,
        chainId,
        safeTxHash,
        tx
    }
    await writeToCliCache(proposalFile(safeTxHash), proposal)
    console.log("Safe transaction hash:", safeTxHash)
    return safeTxHash
}

const signProposal = async (taskArgs: any, hre: HardhatRuntimeEnvironment) => {
    const proposal: SafeTxProposal = await readFromCliCache(proposalFile(taskArgs.hash))
    const signers = await hre.ethers.getSigners()
    const signer = signers[taskArgs.signerIndex]
    const safe = await safeSingleton(hre, proposal.safe)
    const safeAddress = await safe.resolvedAddress
    console.log(`Using Safe at ${safeAddress} with ${signer.address}`)
    const owners: string[] = await safe.getOwners()
    if (owners.indexOf(signer.address) < 0) {
        throw Error(`Signer is not an owner of the Safe. Owners: ${owners}`)
    }
    const signature = await signHash(signer, taskArgs.hash)
    await updateSignatureFile(taskArgs.hash, signature)
    console.log(`Signature: ${signature.data}`)
}

const submitProposal = async (taskArgs: any, hre: HardhatRuntimeEnvironment) => {
    console.log(`Running on ${hre.network.name}`)
    const proposal: SafeTxProposal = await readFromCliCache(proposalFile(taskArgs.hash))
    const signers = await hre.ethers.getSigners()
    const signer = signers[taskArgs.signerIndex]
    const safe = await safeSingleton(hre, proposal.safe)
    const safeAddress = await safe.resolvedAddress
    console.log(`Using Safe at ${safeAddress} with ${signer.address}`)
    const currentNonce = await safe.nonce()
    if (!BigNumber.from(proposal.tx.nonce).eq(currentNonce)) {
        throw Error("Proposal does not have correct nonce!")
    }
    const signatureStrings: Record<string, string> = await loadSignatures(taskArgs.hash)
    const signatureArray = Object.values(signatureStrings)
    if (taskArgs.signatures) {
        signatureArray.push(taskArgs.signatures)
    }
    const signatures = await prepareSignatures(safe, proposal.tx, signatureArray.join(","), signer, taskArgs.hash)
    const populatedTx: PopulatedTransaction = await populateExecuteTx(safe, proposal.tx, signatures, { gasLimit: taskArgs.gasLimit, gasPrice: taskArgs.gasPrice })
    
    if (taskArgs.buildOnly) {
        console.log("Ethereum transaction:", populatedTx)
        return
    }
    
    const receipt = await signer.sendTransaction(populatedTx).then(tx => tx.wait())
    console.log("Ethereum transaction hash:", receipt.transactionHash)
    return receipt.transactionHash
}

task("execute-custom-proposal", "Create and Execute a Safe tx proposal json file")
    .addPositionalParam("address", "Address or ENS name of the Safe to check", undefined, types.string)
    .addPositionalParam("txsFile", "Json file with transactions", undefined, types.inputFile)
    .setAction(async (taskArgs, hre) => {
      const txHash = await createProposal(taskArgs, hre)
      taskArgs.hash = txHash
      taskArgs.signerIndex = 0
      await signProposal(taskArgs, hre)
      taskArgs.gasPrice = undefined
      taskArgs.gasLimit = undefined
      await submitProposal(taskArgs, hre)
    });
