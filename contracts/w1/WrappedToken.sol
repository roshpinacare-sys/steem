// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · W1 DEX core on Zero-9369 ($0 gas) · r192-b
//
// WrappedToken — operator-gated wrapper asset (WUSDS first).
// Law L1 (redemption-truth): every unit shown must be redeemable 1:1.
//   · mint  — ONLY the single operator, against 1:1 locked backing
//             (full-reserve book; attested hourly by the PoR feed).
//   · burn  — ONLY the single operator (the real redemption path:
//             operator burns ↔ settles the underlying 1:1).
// Holders transfer freely; nobody can inflate past the book.
// PoR: sovereign/w1-por.json {at, backing, supply, ok} — backing ≥ supply.
// ─────────────────────────────────────────────────────────────────────

contract WrappedToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    address public immutable operator; // sole mint/burn authority (law L1)

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Mint(address indexed to, uint256 value, address indexed byOperator);
    event Burn(address indexed from, uint256 value, address indexed byOperator);

    modifier onlyOperator() {
        require(msg.sender == operator, "W: NOT-OPERATOR");
        _;
    }

    constructor(string memory _name, string memory _symbol, address _operator) {
        require(_operator != address(0), "W: OPERATOR-0");
        name = _name;
        symbol = _symbol;
        operator = _operator;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "W: ALLOWANCE");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _move(from, to, value);
        return true;
    }

    /// Operator-only mint against 1:1 locked backing (full-reserve duty).
    function mint(address to, uint256 value) external onlyOperator {
        require(value > 0, "W: MINT-0");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
        emit Mint(to, value, msg.sender);
    }

    /// Operator-only burn — the real 1:1 redemption path (law L1).
    function burn(address from, uint256 value) external onlyOperator {
        uint256 b = balanceOf[from];
        require(b >= value, "W: BALANCE");
        balanceOf[from] = b - value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
        emit Burn(from, value, msg.sender);
    }

    function _move(address from, address to, uint256 value) internal {
        require(to != address(0), "W: TO-0");
        uint256 b = balanceOf[from];
        require(b >= value, "W: BALANCE");
        balanceOf[from] = b - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
