import path from 'path'
import fs from 'fs/promises'
import fsSync from 'fs'
import csvParser from "csv-parser"
import { MetaTransaction } from '@gnosis.pm/safe-contracts'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { JsonRpcProvider } from '@ethersproject/providers'

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

export const getCustomSigner = () => {
    // the account to be used must be unlocked
    const url = process.env.NODE_URL || ''
    const chainID = process.env.CHAIN_ID || ''
    const account = process.env.IMPERSONATE_ACCOUNT || ''
    const provider = new JsonRpcProvider(url, parseInt(chainID))
    const signer = provider.getSigner(account)
    return SignerWithAddress.create(signer)
}

export const getSignerFromConfig = async (hre: HardhatRuntimeEnvironment, taskArgs: any) => {
    if (hre.network.name === 'custom' && hre.network.config.from) {
        // @todo we can use the getSigner from hardhat because it's only allowed in hardhat networks (we are using ganache)
        // const from = hre.network.config.from
        // const signer = await hre.ethers.getSigner(from) // can not use signer from hardhat
        const signer = await getCustomSigner()
        return signer
    } else {
        const signers = await hre.ethers.getSigners()
        const signer = signers[taskArgs.signerIndex]
        return signer
    }
}
