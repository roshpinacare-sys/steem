// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · W1 DEX core on Zero-9369 ($0 gas) · r192-b
//
// Factory — creates Pair contracts (constant-product x·y=k, 30bps fee
// split 70% LP / 30% treasury per the saos-dex convention).
// Minimal UniV2 shape (r189 §5 W1): getPair + allPairs + createPair.
// ─────────────────────────────────────────────────────────────────────

interface IPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

contract Factory {
    address public immutable treasury; // receives the 30% treasury fee share

    address[] public allPairs;
    mapping(address => mapping(address => address)) public getPair;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 count);

    constructor(address _treasury) {
        require(_treasury != address(0), "F: TREASURY-0");
        treasury = _treasury;
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "F: IDENTICAL");
        require(tokenA != address(0) && tokenB != address(0), "F: TOKEN-0");
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(getPair[t0][t1] == address(0), "F: PAIR-EXISTS");

        // CREATE — address derivable from (factory, factory-nonce); no salt games in W1.
        Pair p = new Pair(t0, t1, treasury);
        pair = address(p);

        getPair[t0][t1] = pair;
        getPair[t1][t0] = pair;
        allPairs.push(pair);
        emit PairCreated(t0, t1, pair, allPairs.length);
    }
}

// ─────────────────────────────────────────────────────────────────────
// Pair — constant-product AMM, 30bps fee: 21bps retained in-pool for
// LPs (70%) + 9bps transferred to treasury (30%). Output math uses the
// fee-adjusted effective input (10000 − 30 bps scale), so k never
// decreases: (rIn + effectiveIn + lpFee)·(rOut − out) ≥ rIn·rOut.
// ─────────────────────────────────────────────────────────────────────

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract Pair {
    // ── fee model (saos-dex convention) ──
    uint256 public constant FEE_DENOM = 10000;
    uint256 public constant TOTAL_FEE_BPS = 30;     // 0.30% total fee
    uint256 public constant LP_FEE_BPS = 21;        // 70% of 30 → stays with LPs
    uint256 public constant TREASURY_FEE_BPS = 9;   // 30% of 30 → treasury

    address public immutable token0;
    address public immutable token1;
    address public immutable treasury;

    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public blockTimestampLast;

    // minimal LP token
    string public constant name = "W1-LP";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bool private locked;
    modifier lock() {
        require(!locked, "P: REENTRANCY");
        locked = true;
        _;
        locked = false;
    }

    event Mint(address indexed to, uint256 value);
    event Burn(address indexed from, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Swap(address indexed sender, address tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);
    event Sync(uint256 reserve0, uint256 reserve1);

    constructor(address _token0, address _token1, address _treasury) {
        require(_token0 != address(0) && _token1 != address(0), "P: TOKEN-0");
        require(_token0 != _token1, "P: IDENTICAL");
        require(_treasury != address(0), "P: TREASURY-0");
        token0 = _token0;
        token1 = _token1;
        treasury = _treasury;
    }

    // ── minimal LP ERC20 surface ──
    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _lpMove(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= value, "P: LP-ALLOWANCE");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - value;
        _lpMove(from, to, value);
        return true;
    }

    function _lpMove(address from, address to, uint256 value) internal {
        require(to != address(0), "P: LP-TO-0");
        uint256 b = balanceOf[from];
        require(b >= value, "P: LP-BALANCE");
        balanceOf[from] = b - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    // ── liquidity ──
    function addLiquidity(uint256 amount0, uint256 amount1, address to) external lock returns (uint256 liquidity) {
        require(amount0 > 0 && amount1 > 0, "P: AMOUNTS");
        IERC20(token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(token1).transferFrom(msg.sender, address(this), amount1);
        if (totalSupply == 0) {
            // first provision: geometric mean, floored (k = a·b)
            liquidity = _sqrt(amount0 * amount1);
        } else {
            liquidity = _min((amount0 * totalSupply) / reserve0, (amount1 * totalSupply) / reserve1);
        }
        require(liquidity > 0, "P: LIQ-DUST");
        totalSupply += liquidity;
        balanceOf[to] += liquidity;
        emit Transfer(address(0), to, liquidity);
        emit Mint(to, liquidity);
        _syncFromBalances();
    }

    function removeLiquidity(uint256 liquidity, uint256 min0, uint256 min1, address to)
        external
        lock
        returns (uint256 amount0, uint256 amount1)
    {
        uint256 bal0 = IERC20(token0).balanceOf(address(this));
        uint256 bal1 = IERC20(token1).balanceOf(address(this));
        amount0 = (liquidity * bal0) / totalSupply;
        amount1 = (liquidity * bal1) / totalSupply;
        require(amount0 >= min0 && amount1 >= min1, "P: MIN_OUT");
        require(amount0 > 0 && amount1 > 0, "P: REM-DUST");
        // burn LP (inline — _lpMove rejects the zero-address)
        uint256 lb = balanceOf[msg.sender];
        require(lb >= liquidity, "P: LP-BALANCE");
        balanceOf[msg.sender] = lb - liquidity;
        totalSupply -= liquidity;
        emit Transfer(msg.sender, address(0), liquidity);
        emit Burn(msg.sender, liquidity);
        IERC20(token0).transfer(to, amount0);
        IERC20(token1).transfer(to, amount1);
        _syncFromBalances();
    }

    // ── swap math (mirror-tested in /tmp/r192-b-tests.mjs before broadcast) ──
    // out = eff·rOut/(rIn + eff) — algebraically the classic UniV2 form
    // in·997·rOut/(rIn·1000 + in·997) with eff = fee-deducted remainder.
    function getAmountOut(uint256 amountIn, address tokenIn) public view returns (uint256 amountOut) {
        (uint256 rIn, uint256 rOut) = tokenIn == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
        (uint256 effectiveIn, , ) = _feeSplit(amountIn);
        amountOut = (effectiveIn * rOut) / (rIn + effectiveIn);
    }

    /// Constant-product swap with deadline + minOut (defense in depth:
    /// enforced here AND in the router).
    function swap(uint256 amountIn, address tokenIn, uint256 minOut, address to, uint256 deadline)
        external
        lock
        returns (uint256 amountOut)
    {
        require(block.timestamp <= deadline, "P: DEADLINE");
        require(tokenIn == token0 || tokenIn == token1, "P: TOKEN");
        require(to != address(0) && to != address(this), "P: TO");
        bool inIsToken0 = tokenIn == token0;
        (uint256 rIn, uint256 rOut) = inIsToken0 ? (reserve0, reserve1) : (reserve1, reserve0);
        require(rIn > 0 && rOut > 0, "P: LIQUIDITY");

        // fee split: 21bps LP (stays in pool) + 9bps treasury; the exact
        // remainder effectiveIn keeps the math integer-safe for dust.
        uint256 treasuryFee = (amountIn * TREASURY_FEE_BPS) / FEE_DENOM;
        uint256 effectiveIn = amountIn - (amountIn * LP_FEE_BPS) / FEE_DENOM - treasuryFee;

        amountOut = (effectiveIn * rOut) / (rIn + effectiveIn);
        require(amountOut > 0, "P: DUST");
        require(amountOut >= minOut, "P: MIN_OUT");

        // pull the full amount in, skim the treasury share, pay the trader
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        if (treasuryFee > 0) IERC20(tokenIn).transfer(treasury, treasuryFee);
        IERC20(inIsToken0 ? token1 : token0).transfer(to, amountOut);

        // LP protection: pool balances (post-swap, post-skim) must never
        // shrink k — 21bps stays inside on every swap.
        uint256 bal0 = IERC20(token0).balanceOf(address(this));
        uint256 bal1 = IERC20(token1).balanceOf(address(this));
        require(bal0 * bal1 >= reserve0 * reserve1, "P: K");
        _syncFromBalances();
        emit Swap(msg.sender, tokenIn, amountIn, amountOut, to);
    }

    /// fee split: (effectiveIn, lpFee, treasuryFee) — exact remainder keeps
    /// the split integer-safe for dust (no double-flooring inversion).
    function _feeSplit(uint256 amountIn)
        internal
        pure
        returns (uint256 effectiveIn, uint256 lpFee, uint256 treasuryFee)
    {
        lpFee = (amountIn * LP_FEE_BPS) / FEE_DENOM;
        treasuryFee = (amountIn * TREASURY_FEE_BPS) / FEE_DENOM;
        effectiveIn = amountIn - lpFee - treasuryFee;
    }

    function _syncFromBalances() internal {
        reserve0 = IERC20(token0).balanceOf(address(this));
        reserve1 = IERC20(token1).balanceOf(address(this));
        blockTimestampLast = block.timestamp;
        emit Sync(reserve0, reserve1);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
