// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRestorationEscrow {
    enum PlanType {
        NATURAL_REGEN,
        ASSISTED
    }

    enum Status {
        Active,
        Paused,
        Failed,
        Completed
    }

    /// @param bps          share of the plot's funds settled at this milestone (all milestones sum to 10000)
    /// @param targetBps    score that earns the full tranche; 0 = binary check (any positive score passes)
    /// @param failBelowBps if the earned fraction (of target, in bps) is below this, the whole plot fails; 0 = never
    /// @param dueAt        report deadline (unix time); after it anyone may fail an unreported plot; 0 = none
    struct Milestone {
        uint16 bps;
        uint16 targetBps;
        uint16 failBelowBps;
        uint64 dueAt;
    }

    struct Plot {
        address steward;
        PlanType planType;
        Status status;
        uint8 nextMilestone;
        uint16 settledBps; // sum of bps of executed milestones
        uint64 pausedAt;
        Milestone[] milestones;
        uint256 totalFunded;
        uint256 refundableFunded; // portion of totalFunded whose funders chose refunds (rest → replanting pool)
        uint256 settled; // funds already paid out or refunded
        uint256 released; // paid to the steward (incl. verifier fee)
        uint256 refunded; // returned to funders or the replanting pool
        uint256 accRefundPerUnit; // refunds per refundable unit, scaled by 1e18
        string name;
        string metadataURI;
    }

    struct Report {
        bool exists;
        bool executed;
        bool challenged;
        int32 scoreBps;
        uint16 fractionBps; // share of the tranche earned, set on execution
        uint64 reportedAt;
        address challenger;
        bytes32 evidenceHash;
        bytes32 datasetRoot; // committed evidence set this report was proven against
    }

    struct Position {
        uint256 amount;
        bool refundOnFail;
        uint256 refundDebt; // accRefundPerUnit already accounted for this position
        uint256 refundClaimed;
    }

    /// @notice An evidence set committed by the oracle committee: Merkle root of all scores + where the files live.
    struct Dataset {
        uint64 committedAt;
        uint32 index;
        string cid; // IPFS CID of the evidence files
    }

    function getPlot(uint256 plotId) external view returns (Plot memory);
    function positionOf(uint256 plotId, address funder) external view returns (Position memory);
    function fund(uint256 plotId, uint256 amount, bool refundOnFail) external;
}
