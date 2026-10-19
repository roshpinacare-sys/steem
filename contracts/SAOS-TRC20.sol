// SPDX-License-Identifier: MIT
// SAOS-TRC20.sol — W15 · THE CHAIN-TOKEN READINESS KIT (ערכת-מוכנות-טוקן-על-השרשרת).
//
// OPERATOR ORDER 2026-10-19: "אפשר לפתוח טוקנים וארנקים על הרשת" — W14
// shipped HCT-1 as an honest BOOK-LAW token (internal accounting, chainless);
// THIS contract is the lawful next rung: a real TRC-20 source, READY and
// GUARDED, deployed only when the treasury wallet (treasury:hct-1,
// TFKfK7AQRPZSKKU9MHoLFmWeL4gEvXzdHi) is funded with the gas to deploy
// (~30 TRX + energy). scripts/token-arm-w15.mjs enforces ARMED-NOT-FIRED.
//
// HONESTY LAWS:
//  - 1 HCT (chain incarnation) = 1 HCT (book-law) — the deployment transfer
//    mirrors the book ledger's treasury position at deploy time; the chain
//    ledger and the book ledger MUST agree before any transfer moves.
//  - This file is a SOURCE, not a deployment. No claim of existence on chain
//    until tronscan shows the contract — the chain is the judge (R306-b).

pragma solidity ^0.8.20;

contract SAOSTRC20 {
    string public constant name = "Head Corner Token 1";
    string public constant symbol = "HCT";
    uint8  public constant decimals = 0; // book-law whole units — mirrors HCT-1 exactly
    uint256 public totalSupply;

    address public owner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed tokenOwner, address indexed spender, uint256 value);
    event Mint(address indexed to, uint256 value);

    constructor(uint256 genesisSupply, address treasury) {
        owner = msg.sender;
        totalSupply = genesisSupply;
        balanceOf[treasury] = genesisSupply;
        emit Mint(treasury, genesisSupply);
        emit Transfer(address(0), treasury, genesisSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "HCT: allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 value) external {
        require(msg.sender == owner, "HCT: owner only");
        totalSupply += value;
        balanceOf[to] += value;
        emit Mint(to, value);
        emit Transfer(address(0), to, value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "HCT: zero");
        require(balanceOf[from] >= value, "HCT: balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
