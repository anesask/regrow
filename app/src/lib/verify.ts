import { encodeAbiParameters, type Hex, keccak256, parseAbiParameters, toBytes } from 'viem'
import { API_URL } from './api'

export interface DatasetLeaf {
  kind: 0 | 1
  plot: string
  plotId: number
  idx: number
  scoreBps: number
  evidenceHash: Hex
  file: string
  leaf: Hex
  proof: Hex[]
}

export interface Dataset {
  root: Hex
  cid: string
  bundle: string
  leaves: DatasetLeaf[]
}

let datasetCache: Promise<Dataset> | null = null
export const fetchDataset = () => (datasetCache ??= fetch(`${API_URL}/data/dataset.json`).then((r) => r.json() as Promise<Dataset>))

/** Same leaf encoding as RestorationEscrow.leaf(): keccak256(keccak256(abi.encode(kind, plotId, idx, score, hash))). */
export function leafHash(kind: number, plotId: number, idx: number, scoreBps: number, evidenceHash: Hex): Hex {
  const inner = keccak256(
    encodeAbiParameters(parseAbiParameters('uint8, uint256, uint8, int32, bytes32'), [kind, BigInt(plotId), idx, scoreBps, evidenceHash]),
  )
  return keccak256(inner)
}

/** OpenZeppelin MerkleProof: hash sorted pairs up to the root. */
export function foldProof(leaf: Hex, proof: Hex[]): Hex {
  let h = leaf
  for (const p of proof) {
    const [a, b] = BigInt(h) < BigInt(p) ? [h, p] : [p, h]
    h = keccak256(new Uint8Array([...toBytes(a), ...toBytes(b)]))
  }
  return h
}

/** keccak-256 of the exact bytes of a published evidence file. */
export async function hashEvidenceFile(file: string): Promise<{ hash: Hex; bytes: number }> {
  const res = await fetch(`${API_URL}/data/evidence/${file}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`evidence file not found (${res.status})`)
  const buf = new Uint8Array(await res.arrayBuffer())
  return { hash: keccak256(buf), bytes: buf.length }
}
