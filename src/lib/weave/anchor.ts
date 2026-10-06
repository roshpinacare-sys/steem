// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Anchor — עוגן EVM: מה בדיוק היה יורד לשרשרת
//
// עיקרון יושר: סודות לעולם לא עולים לשרשרת. רק שורשים (roots).
// ה-calldata כאן אמיתי לחלוטין (ABI-encoding תקני) — מוכן לשליחה
// ברגע שיהיה חותם ממומן ורשת יעד. עד אז: anchorStatus = LOCAL.
// ─────────────────────────────────────────────────────────────────────

import { Interface } from "ethers";

export const ANCHOR_REGISTRY_ABI = [
  "function anchor(bytes32 root) external",
  "function roots(uint256) external view returns (bytes32)",
  "function latestIndex() external view returns (uint256)",
  "function verifyRoot(uint256 index, bytes32 expected) external view returns (bool)",
  "event RootAnchored(uint256 indexed index, bytes32 root, address indexed anchorer)",
];

/** חוזה העוגן — מינימלי, בר-ביקורת, ללא בעלות מיוחדת */
export const ANCHOR_REGISTRY_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title WeaveAnchorRegistry — עוגן שורשים עבור ספר אימותים
/// @notice רק שורשים יורדים לשרשרת. אף סוד, אף מפתח, אף ciphertext.
contract WeaveAnchorRegistry {
    mapping(uint256 => bytes32) public roots;
    uint256 public latestIndex;

    event RootAnchored(uint256 indexed index, bytes32 root, address indexed anchorer);

    function anchor(bytes32 root) external {
        require(root != bytes32(0), "empty root");
        latestIndex += 1;
        roots[latestIndex] = root;
        emit RootAnchored(latestIndex, root, msg.sender);
    }

    function verifyRoot(uint256 index, bytes32 expected) external view returns (bool) {
        return roots[index] == expected;
    }
}`;

export const ANCHOR_REGISTRY_DEPLOY_BYTECODE_PLACEHOLDER =
  "NOT-DEPLOYED — החוזה מוכן, הפריסה נעולה מאחורי שער EVM-1 (חותם ממומן + רשת יעד)";

/**
 * ה-calldata המדויק של anchor(bytes32) — לתצוגה, להעתקה ולביקורת.
 * על השרשרת החוזה מנהל את האינדקס שלו עצמו (latestIndex),
 * ואינדקס ה-checkpoint הפנימי שלנו נשמר בקישור החוצה (off-chain linkage).
 */
export function anchorCalldata(root: string): string {
  const iface = new Interface(ANCHOR_REGISTRY_ABI);
  return iface.encodeFunctionData("anchor", [root]);
}
