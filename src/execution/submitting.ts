import { BigNumber, PopulatedTransaction } from "ethers";
import { task, types } from "hardhat/config";
import { safeSingleton } from "../contracts";
import { buildSafeTransaction, populateExecuteTx } from "@gnosis.pm/safe-contracts";
import { parseEther } from "@ethersproject/units";
import { isHexString } from "ethers/lib/utils";
import { loadSignatures, prepareSignatures, proposalFile, readFromCliCache, SafeTxProposal } from "./utils";

task("submit-tx", "Executes a Safe transaction")
    .addPositionalParam("address", "Address or ENS name of the Safe to check", undefined, types.string)
    .addParam("to", "Address of the target", undefined, types.string)
    .addParam("value", "Value in ETH", "0", types.string, true)
    .addParam("data", "Data as hex string", "0x", types.string, true)
    .addParam("signatures", "Comma seperated list of signatures", undefined, types.string, true)
    .addParam("gasPrice", "Gas price to be used", undefined, types.int, true)
    .addParam("gasLimit", "Gas limit to be used", undefined, types.int, true)
    .addFlag("delegatecall", "Indicator if tx should be executed as a delegatecall")
    .setAction(async (taskArgs, hre) => {
        console.log(`Running on ${hre.network.name}`)
        const [signer] = await hre.ethers.getSigners()
        const safe = await safeSingleton(hre, taskArgs.address)
        const safeAddress = await safe.resolvedAddress
        console.log(`Using Safe at ${safeAddress} with ${signer.address}`)
        const nonce = await safe.nonce()
        if (!isHexString(taskArgs.data)) throw Error(`Invalid hex string provided for data: ${taskArgs.data}`)
        const tx = buildSafeTransaction({ 
            to: taskArgs.to, 
            value: parseEther(taskArgs.value), 
            data: taskArgs.data, 
            nonce, 
            operation: taskArgs.delegatecall ? 1 : 0 
        })
        const signatures = await prepareSignatures(safe, tx, taskArgs.signatures, signer)
        const populatedTx: PopulatedTransaction = await populateExecuteTx(safe, tx, signatures, { gasLimit: taskArgs.gasLimit, gasPrice: taskArgs.gasPrice })
        const receipt = await signer.sendTransaction(populatedTx).then(tx => tx.wait())
        console.log(receipt.transactionHash)
    });


task("submit-proposal", "Executes a Safe transaction")
    .addPositionalParam("hash", "Hash of Safe transaction to display", undefined, types.string)
    .addParam("signerIndex", "Index of the signer to use", 0, types.int, true)
    .addParam("signatures", "Comma seperated list of signatures", undefined, types.string, true)
    .addParam("gasPrice", "Gas price to be used", undefined, types.int, true)
    .addParam("gasLimit", "Gas limit to be used", undefined, types.int, true)
    .addFlag("buildOnly", "Flag to only output the final transaction")
    .setAction(async (taskArgs, hre) => {
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
    });