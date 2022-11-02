import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import csvParser from "csv-parser"
import { buildMultiSendSafeTx, buildSafeTransaction, calculateSafeTransactionHash, MetaTransaction, safeApproveHash, SafeSignature, SafeTransaction } from '@gnosis.pm/safe-contracts'
import { Contract, ethers, Signer, utils } from 'ethers'
import { getAddress, isHexString, parseEther } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { multiSendLib } from '../contracts'

const cliCacheDir = "cli_cache"

export const proposalFile = (safeTxHash: string) => `${safeTxHash}.proposal.json`
export const signaturesFile = (safeTxHash: string) => `${safeTxHash}.signatures.json`

export const writeToCliCache = async(key: string, content: any) => {
    const folder = path.join(process.cwd(), cliCacheDir)
    try {
        await fs.access(folder)
    } catch (e) {
        await fs.mkdir(folder);
    }
    await fs.writeFile(path.join(folder, key), JSON.stringify(content, null, 2))
}

export const writeJson = async(file: string, content: any) => {
    await fs.writeFile(file, JSON.stringify(content, null, 2))
}

export const writeTxBuilderJson = async(file: string, chainId: string, transactions: MetaTransaction[], name?: string, description?: string) => {
    return writeJson(file, {
        version: "1.0",
        chainId,
        createdAt: new Date().getTime(),
        meta: {
            name,
            description
        },
        transactions
    })
}

export const readFromCliCache = async(key: string): Promise<any> => {
    const content = await fs.readFile(path.join(process.cwd(), cliCacheDir, key), 'utf8')
    return JSON.parse(content)
}

export const loadSignatures = async(safeTxHash: string): Promise<Record<string, string>> => {
    try {
        return await readFromCliCache(signaturesFile(safeTxHash))
    } catch {
        return {}
    }
}

export const readCsv = async<T>(file: string): Promise<T[]> => new Promise((resolve, reject) => {
    const results: T[] = [];
    fsSync.createReadStream(file).pipe(csvParser())
        .on("data", (data) => results.push(data))
        .on("error", (err) => { reject(err) })
        .on("end", () => { resolve(results)})
})

/**
 * Proposing utilities
 */

export interface SafeTxProposal {
    safe: string,
    chainId: number,
    safeTxHash: string,
    tx: SafeTransaction
}

export const calcSafeTxHash = async (safe: Contract, tx: SafeTransaction, chainId: number, onChainOnly: boolean): Promise<string> => {
    const onChainHash = await safe.getTransactionHash(
        tx.to, tx.value, tx.data, tx.operation, tx.safeTxGas, tx.baseGas, tx.gasPrice, tx.gasToken, tx.refundReceiver, tx.nonce
    )
    if (onChainOnly) return onChainHash
    const offChainHash = calculateSafeTransactionHash(safe, tx, chainId)
    if (onChainHash != offChainHash) throw Error("Unexpected hash! (For pre-1.3.0 version use --on-chain-hash)")
    return offChainHash
}

export interface TxDescription {
    to: string,
    value: string // in ETH
    data?: string
    method?: string
    params?: any[]
    operation: 0 | 1
}

export const buildData = (method: string, params?: any[]): string => {
    const iface = new ethers.utils.Interface([`function ${method}`])
    return iface.encodeFunctionData(method, params)
}

export const buildMetaTx = (description: TxDescription): MetaTransaction => {
    const to = getAddress(description.to)
    const value = parseEther(description.value).toString()
    const operation = description.operation
    const data = isHexString(description.data) ? description.data!! : (description.method ? buildData(description.method, description.params) : "0x")
    return { to, value, data, operation }
}

export const loadMetaTransactions = async (file: string) => {
    const txsData: TxDescription[] = JSON.parse(await fs.readFile(file, 'utf8'))
    if (txsData.length == 0) {
        throw Error("No transacitons provided")
    }
    return txsData.map(desc => buildMetaTx(desc))
}

export const parseMultiSendJsonFile = async (hre: HardhatRuntimeEnvironment, txs: MetaTransaction[], nonce: number, multiSendAddress?: string): Promise<SafeTransaction> => {
    if (txs.length == 1) {
        return buildSafeTransaction({ ...txs[0], nonce: nonce })
    }
    const multiSend = await multiSendLib(hre, multiSendAddress)
    return buildMultiSendSafeTx(multiSend, txs, nonce)
}

/**
 * Signing Utilities
 */

export const updateSignatureFile = async(safeTxHash: string, signature: SafeSignature) => {
    const signatures: Record<string, string> = await loadSignatures(safeTxHash)
    signatures[signature.signer] = signature.data
    await writeToCliCache(signaturesFile(safeTxHash), signatures)
}

/**
 * Submitting utilities
 */

const parsePreApprovedConfirmation = (data: string): SafeSignature => {
    const signer = getAddress("0x" + data.slice(26, 66))
    return {
        signer, data
    }
}

const parseTypeDataConfirmation = (safeTxHash: string, data: string): SafeSignature => {
    const signer = utils.recoverAddress(safeTxHash, data)
    return {
        signer, data
    }
}

const parseEthSignConfirmation = (safeTxHash: string, data: string): SafeSignature => {
    const signer = utils.recoverAddress(utils.hashMessage(utils.arrayify(safeTxHash)), data.replace(/1f$/, "1b").replace(/20$/, "1c"))
    return {
        signer, data
    }
}

const parseSignature = (safeTxHash: string, signature: string): SafeSignature => {
    if (!isHexString(signature, 65)) throw Error(`Unsupported signature: ${signature}`)
    const type = parseInt(signature.slice(signature.length - 2), 16)
    switch (type) {
        case 1: return parsePreApprovedConfirmation(signature)
        case 27:
        case 28:
            return parseTypeDataConfirmation(safeTxHash, signature)
        case 31:
        case 32:
            return parseEthSignConfirmation(safeTxHash, signature)
        case 0:
        default:
            throw Error(`Unsupported type ${type} in ${signature}`)
    }
}

const isOwnerSignature = (owners: string[], signature: SafeSignature): SafeSignature => {
    if (owners.indexOf(signature.signer) < 0) throw Error(`Signer ${signature.signer} not found in owners ${owners}`)
    return signature
}

export const prepareSignatures = async (safe: Contract, tx: SafeTransaction, signaturesCSV: string | undefined, submitter?: Signer, knownSafeTxHash?: string): Promise<SafeSignature[]> => {
    const owners = await safe.getOwners()
    const signatures = new Map<String, SafeSignature>()
    const submitterAddress = submitter && await submitter.getAddress()
    if (signaturesCSV) {
        const chainId = (await safe.provider.getNetwork()).chainId
        const safeTxHash = knownSafeTxHash ?? calculateSafeTransactionHash(safe, tx, chainId)
        for (const signatureString of signaturesCSV.split(",")) {
            const signature = isOwnerSignature(owners, parseSignature(safeTxHash, signatureString))
            if (submitterAddress === signature.signer || signatures.has(signature.signer)) continue
            signatures.set(signature.signer, signature)
        }
    }
    const threshold = (await safe.getThreshold()).toNumber()
    const submitterIsOwner = submitterAddress && owners.indexOf(submitterAddress) >= 0
    const requiredSigntures = submitterIsOwner ? threshold - 1 : threshold
    if (requiredSigntures > signatures.size) throw Error(`Not enough signatures (${signatures.size} of ${threshold})`)
    const signatureArray = []
    if (submitterIsOwner) {
        signatureArray.push(await safeApproveHash(submitter!!, safe, tx, true))
    }
    return signatureArray.concat(Array.from(signatures.values()).slice(0, requiredSigntures))
}
