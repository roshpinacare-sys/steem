// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · W1 DEX core on Zero-9369 ($0 gas) · r192-b
//
// Router — minimal UniV2-style entry point for the W1 core:
//   · addLiquidity            — optimal-ratio provision, deadline + min
//   · removeLiquidity         — proportional exit, deadline + min
//   · swapExactTokensForTokens— deadline + minOut (slippage guard)
// Pulls from the caller (caller approves this router), pushes to the
// pair; the pair re-checks deadline/minOut (defense in depth).
// ─────────────────────────────────────────────────────────────────────

interface IFactoryW1 {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IPairW1 {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function totalSupply() external view returns (uint256);
    function reserve0() external view returns (uint256);
    function reserve1() external view returns (uint256);
    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256 amountOut);
    function addLiquidity(uint256 amount0, uint256 amount1, address to) external returns (uint256 liquidity);
    function removeLiquidity(uint256 liquidity, uint256 min0, uint256 min1, address to)
        external
        returns (uint256 amount0, uint256 amount1);
    function swap(uint256 amountIn, address tokenIn, uint256 minOut, address to, uint256 deadline)
        external
        returns (uint256 amountOut);
}

interface IERC20W1 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

contract Router {
    address public immutable factory;

    event LiquidityAdded(address indexed pair, address indexed to, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed pair, address indexed to, uint256 amount0, uint256 amount1);
    event Swapped(address indexed pair, address tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);

    modifier deadline(uint256 _deadline) {
        require(block.timestamp <= _deadline, "R: DEADLINE");
        _;
    }

    constructor(address _factory) {
        require(_factory != address(0), "R: FACTORY-0");
        factory = _factory;
    }

    function pairFor(address tokenA, address tokenB) public view returns (address) {
        return IFactoryW1(factory).getPair(tokenA, tokenB);
    }

    function quote(uint256 amountIn, address tokenIn, address tokenOut) public view returns (uint256 amountOut) {
        address pair = pairFor(tokenIn, tokenOut);
        require(pair != address(0), "R: NO-PAIR");
        return IPairW1(pair).getAmountOut(amountIn, tokenIn);
    }

    // ── liquidity ──

    /// First provision: exact desired amounts. Later provisions: the
    /// ratio is set by current reserves; desired amounts are trimmed to
    /// it and the trimmed values must respect amountMin floors.
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 _deadline
    ) external deadline(_deadline) returns (uint256 amount0, uint256 amount1, uint256 liquidity) {
        address pair = pairFor(tokenA, tokenB);
        require(pair != address(0), "R: NO-PAIR");

        (uint256 reserveA, uint256 reserveB) = _reserves(pair, tokenA);
        if (reserveA == 0 && reserveB == 0) {
            (amount0, amount1) = (amountADesired, amountBDesired);
        } else {
            uint256 optimalB = (amountADesired * reserveB) / reserveA;
            if (optimalB <= amountBDesired) {
                (amount0, amount1) = (amountADesired, optimalB);
            } else {
                amount0 = (amountBDesired * reserveA) / reserveB;
                (amount0, amount1) = (amount0, amountBDesired);
            }
        }
        require(amount0 >= amountAMin && amount1 >= amountBMin, "R: MIN_OUT");

        IERC20W1(tokenA).transferFrom(msg.sender, address(this), amount0);
        IERC20W1(tokenB).transferFrom(msg.sender, address(this), amount1);
        IERC20W1(tokenA).approve(pair, amount0);
        IERC20W1(tokenB).approve(pair, amount1);
        address t0 = tokenA < tokenB ? tokenA : tokenB;
        liquidity = IPairW1(pair).addLiquidity(
            t0 == tokenA ? amount0 : amount1,
            t0 == tokenA ? amount1 : amount0,
            to
        );
        emit LiquidityAdded(pair, to, amount0, amount1, liquidity);
    }

    function removeLiquidity(
        address pair,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 _deadline
    ) external deadline(_deadline) returns (uint256 amount0, uint256 amount1) {
        IERC20W1(pair).transferFrom(msg.sender, address(this), liquidity);
        IERC20W1(pair).approve(pair, liquidity);
        address t0 = IPairW1(pair).token0();
        address t1 = IPairW1(pair).token1();
        (uint256 out0, uint256 out1) = IPairW1(pair).removeLiquidity(liquidity, amountAMin, amountBMin, address(this));
        (amount0, amount1) = (out0, out1); // pair-order outputs
        IERC20W1(t0).transfer(to, out0);
        IERC20W1(t1).transfer(to, out1);
        emit LiquidityRemoved(pair, to, out0, out1);
    }

    // ── swap ──

    function swapExactTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address to,
        uint256 _deadline
    ) external deadline(_deadline) returns (uint256 amountOut) {
        address pair = pairFor(tokenIn, tokenOut);
        require(pair != address(0), "R: NO-PAIR");

        amountOut = IPairW1(pair).getAmountOut(amountIn, tokenIn);
        require(amountOut >= minOut && minOut > 0, "R: MIN_OUT");
        require(amountIn > 0, "R: AMOUNT-0");

        IERC20W1(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20W1(tokenIn).approve(pair, amountIn);
        amountOut = IPairW1(pair).swap(amountIn, tokenIn, minOut, to, _deadline);
        emit Swapped(pair, tokenIn, amountIn, amountOut, to);
    }

    function _reserves(address pair, address tokenA) internal view returns (uint256 rA, uint256 rB) {
        (uint256 r0, uint256 r1) = (IPairW1(pair).reserve0(), IPairW1(pair).reserve1());
        (rA, rB) = IPairW1(pair).token0() == tokenA ? (r0, r1) : (r1, r0);
    }
}
