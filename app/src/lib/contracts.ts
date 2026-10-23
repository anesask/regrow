import { keccak256, stringToBytes } from 'viem'
import { useReadContract } from 'wagmi'
import addresses from './chain/addresses.json'
import { ImpactCertificateAbi, FilizAbi, RecoveryRegistryAbi, RestorationEscrowAbi, TimelockControllerAbi } from './chain/abis'

export { addresses }

export const escrow = { address: addresses.RestorationEscrow as `0x${string}`, abi: RestorationEscrowAbi } as const
export const flz = { address: addresses.Filiz as `0x${string}`, abi: FilizAbi } as const
export const certificate = { address: addresses.ImpactCertificate as `0x${string}`, abi: ImpactCertificateAbi } as const

const ZERO = '0x0000000000000000000000000000000000000000'
const optional = (key: string) => ((addresses as Record<string, unknown>)[key] as `0x${string}` | undefined) ?? ZERO
export const registry = { address: optional('RecoveryRegistry'), abi: RecoveryRegistryAbi } as const
export const timelock = { address: optional('TimelockController'), abi: TimelockControllerAbi } as const
export const hasRegistry = registry.address !== ZERO
export const VRU_DECIMALS = 2
export const formatVru = (v: bigint | number | undefined) =>
  v === undefined ? '-' : (Number(v) / 10 ** VRU_DECIMALS).toLocaleString('en-US', { maximumFractionDigits: 2 })

export const deployed = addresses.RestorationEscrow !== '0x0000000000000000000000000000000000000000'

export const STATUS = ['Active', 'Paused', 'Failed', 'Completed'] as const
export type PlotStatus = (typeof STATUS)[number]

export const FLZ_DECIMALS = 6
export const formatFlz = (v: bigint | undefined) =>
  v === undefined ? '-' : (Number(v) / 10 ** FLZ_DECIMALS).toLocaleString('en-US', { maximumFractionDigits: 2 })

export function usePlotOnChain(chainId: number | null | undefined) {
  const enabled = deployed && chainId != null
  const plot = useReadContract({
    ...escrow,
    functionName: 'getPlot',
    args: [BigInt(chainId ?? 0)],
    query: { enabled, refetchInterval: 15_000 },
  })
  const reports = useReadContract({
    ...escrow,
    functionName: 'getReports',
    args: [BigInt(chainId ?? 0)],
    query: { enabled, refetchInterval: 15_000 },
  })
  return { plot, reports, status: plot.data ? STATUS[plot.data.status] : undefined }
}

/** Public link reference of a certificate (/certificate/<ref>) instead of its sequential token id. Same formula as
 *  cert_ref() in backend/src/regrow_api/certificates.py. */
export const certificateRef = (tokenId: number | bigint) =>
  keccak256(stringToBytes(`${addresses.ImpactCertificate.toLowerCase()}:${tokenId}`)).slice(2, 14)
