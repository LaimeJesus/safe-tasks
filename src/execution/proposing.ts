import { task, types } from "hardhat/config";
import { safeSingleton } from "../contracts";
import { buildSafeTransaction } from "@gnosis.pm/safe-contracts";
import { parseEther } from "@ethersproject/units";
import { isHexString } from "ethers/lib/utils";
import { calcSafeTxHash, loadMetaTransactions, parseMultiSendJsonFile, proposalFile, readFromCliCache, SafeTxProposal, writeToCliCache, writeTxBuilderJson } from "./utils";
import { BigNumber } from "@ethersproject/bignumber";

task("propose", "Create a Safe tx proposal json file")
    .addPositionalParam("address", "Address or ENS name of the Safe to check", undefined, types.string)
    .addParam("to", "Address of the target", undefined, types.string)
    .addParam("value", "Value in ETH", "0", types.string, true)
    .addParam("data", "Data as hex string", "0x", types.string, true)
    .addFlag("delegatecall", "Indicator if tx should be executed as a delegatecall")
    .addFlag("onChainHash", "Get hash from chain (required for pre-1.3.0 version)")
    .setAction(async (taskArgs, hre) => {
        console.log(`Running on ${hre.network.name}`)
        const safe = await safeSingleton(hre, taskArgs.address)
        const safeAddress = await safe.resolvedAddress
        console.log(`Using Safe at ${safeAddress}`)
        const nonce = await safe.nonce()
        if (!isHexString(taskArgs.data)) throw Error(`Invalid hex string provided for data: ${taskArgs.data}`)
        const tx = buildSafeTransaction({ to: taskArgs.to, value: parseEther(taskArgs.value).toString(), data: taskArgs.data, nonce: nonce.toString(), operation: taskArgs.delegatecall ? 1 : 0 })
        const chainId = (await safe.provider.getNetwork()).chainId
        const safeTxHash = await calcSafeTxHash(safe, tx, chainId, taskArgs.onChainHash)
        const proposal: SafeTxProposal = {
            safe: safeAddress,
            chainId,
            safeTxHash,
            tx
        }
        await writeToCliCache(proposalFile(safeTxHash), proposal)
        console.log(`Safe transaction hash: ${safeTxHash}`)
    });

task("propose-multi", "Create a Safe tx proposal json file")
    .addPositionalParam("address", "Address or ENS name of the Safe to check", undefined, types.string)
    .addPositionalParam("txs", "Json file with transactions", undefined, types.inputFile)
    .addParam("multiSend", "Set to overwrite which multiSend address to use", "", types.string, true)
    .addParam("nonce", "Set nonce to use (will default to on-chain nonce)", "", types.string, true)
    .addParam("export", "If specified instead of executing the data will be exported as a json file for the transaction builder", undefined, types.string)
    .addParam("name", "Name to be used for the transaction builder json", undefined, types.string, true)
    .addFlag("onChainHash", "Get hash from chain (required for pre-1.3.0 version)")
    .setAction(async (taskArgs, hre) => {
        console.log(`Running on ${hre.network.name}`)
        const safe = await safeSingleton(hre, taskArgs.address)
        const safeAddress = await safe.resolvedAddress
        console.log(`Using Safe at ${safeAddress}`)
        const nonce = taskArgs.nonce || await safe.nonce()
        const txs = await loadMetaTransactions(taskArgs.txs)
        const chainId = (await safe.provider.getNetwork()).chainId
        if (taskArgs.export) {
            await writeTxBuilderJson(taskArgs.export, chainId.toString(), txs, taskArgs.name || "Custom Transactions")
            return
        } 
        const tx = await parseMultiSendJsonFile(hre, txs, BigNumber.from(nonce).toNumber(), taskArgs.multiSend)
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
    });

task("show-proposal", "Shows details for a Safe transaction")
    .addPositionalParam("hash", "Hash of Safe transaction to display", undefined, types.string)
    .setAction(async (taskArgs, hre) => {
        const proposal: SafeTxProposal = await readFromCliCache(proposalFile(taskArgs.hash))
        const safe = await safeSingleton(hre, taskArgs.address)
        const safeAddress = await safe.resolvedAddress
        console.log(`Using Safe at ${safeAddress}@${proposal.chainId}`)
        const nonce = await safe.nonce()
        if (BigNumber.from(proposal.tx.nonce).lt(nonce)) {
            console.log(`!Nonce has already been used!`)
        }
        console.log("Details")
        console.log(proposal.tx)
    });
