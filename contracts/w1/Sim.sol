// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

// ─────────────────────────────────────────────────────────────────────
// r192-b · SIM-ONLY harness — NEVER deployed.
//
// eth_call creation simulation on rpc.zero.tech: this constructor
// exercises the REAL compiled W1 bytecode (Factory, WrappedToken,
// Pair, Router) end-to-end in a single throwaway execution:
//   deploy → mint → createPair → addLiquidity → swap → guards →
//   removeLiquidity — and returns ABI-encoded measurements.
// Expected-revert cases are probed with low-level calls through Actor.
// ─────────────────────────────────────────────────────────────────────

import "./Pair.sol";
import "./Router.sol";
import "./WrappedToken.sol";

contract Actor {
    // probes from a NON-operator identity (revert ⇒ guard held ⇒ returns false)
    function tryMint(address token) external returns (bool ok) {
        (bool success, ) = address(this).call(abi.encodeCall(this.mintNow, token));
        return success;
    }

    function mintNow(address token) external {
        WrappedToken(token).mint(address(this), 1);
    }

    function tryBurn(address token, address from) external returns (bool ok) {
        (bool success, ) = address(this).call(abi.encodeCall(this.burnNow, (token, from)));
        return success;
    }

    function burnNow(address token, address from) external {
        WrappedToken(token).burn(from, 1);
    }
}

contract Sim {
    uint256 public constant E18 = 10 ** 18;

    function run() external returns (
        address factoryAddr,
        address pairAddr,
        address routerAddr,
        address wusdsAddr,
        uint256 liquidity,
        uint256 quoteOut,
        uint256 swapOut,
        uint256 treasuryWusds,
        uint256 kBefore,
        uint256 kAfter,
        uint256 removeOut0,
        uint256 removeOut1,
        uint8 guardMinOut,
        uint8 guardDeadline,
        uint8 guardNonOpMint,
        uint8 guardNonOpBurn
    ) {
        // 1. deploy the W1 core (operator == this Sim — mints in-line)
        Factory factory = new Factory(address(this));
        WrappedToken wusds = new WrappedToken("Wrapped USDS (Zero W1)", "WUSDS", address(this));
        WrappedToken counter = new WrappedToken("SimCounter", "CTR", address(this));
        Router router = new Router(address(factory));
        factoryAddr = address(factory);
        wusdsAddr = address(wusds);
        routerAddr = address(router);

        // 2. pair creation through the real factory (sorted, unique)
        address pairAddress = factory.createPair(address(wusds), address(counter));
        pairAddr = pairAddress;
        Pair pair = Pair(pairAddress);

        // 3. operator mints (law L1 path) — LP + trader + router-side
        wusds.mint(address(this), 1_000_000 * E18);
        counter.mint(address(this), 1_000_000 * E18);
        wusds.mint(address(0xD1), 50_000 * E18); // trader
        counter.mint(address(0xD1), 50_000 * E18);

        // 4. first provision through the real router (approve → pull → pair)
        wusds.approve(address(router), type(uint256).max);
        counter.approve(address(router), type(uint256).max);
        (, , liquidity) = router.addLiquidity(
            address(wusds), address(counter),
            100_000 * E18, 100_000 * E18,
            90_000 * E18, 90_000 * E18,
            address(this), block.timestamp + 100
        );

        uint256 r0 = pair.reserve0();
        uint256 r1 = pair.reserve1();
        kBefore = r0 * r1;

        // 5. trader swap through the real router (WUSDS → counter)
        quoteOut = router.quote(1000 * E18, address(wusds), address(counter));
        swapOut = router.swapExactTokensForTokens(
            address(wusds), address(counter),
            1000 * E18, quoteOut, address(0xD1), block.timestamp + 100
        );

        uint256 r0b = pair.reserve0();
        uint256 r1b = pair.reserve1();
        kAfter = r0b * r1b;

        // 6. guards — every one of these MUST revert (low-level probes)
        (bool okMinOut, ) = address(router).call(
            abi.encodeWithSelector(
                Router.swapExactTokensForTokens.selector,
                address(wusds), address(counter), 1000 * E18, quoteOut + 1, address(0xD1), block.timestamp + 100
            )
        );
        guardMinOut = okMinOut ? 0 : 1;

        (bool okDeadline, ) = address(router).call(
            abi.encodeWithSelector(
                Router.swapExactTokensForTokens.selector,
                address(wusds), address(counter), 1000 * E18, 1, address(0xD1), block.timestamp - 1
            )
        );
        guardDeadline = okDeadline ? 0 : 1;

        Actor actor = new Actor();
        guardNonOpMint = actor.tryMint(address(wusds)) ? 0 : 1;
        guardNonOpBurn = actor.tryBurn(address(wusds), address(0xD1)) ? 0 : 1;

        // 7. treasury share: 9bps of every swap-in (30% of 30bps).
        // Sim's WUSDS ledger: 1,000,000 minted − 100,000 pulled by router
        // for LP = 900,000; the 0.9 (= 1000·9bps) extra is the treasury fee.
        treasuryWusds = wusds.balanceOf(address(this)) - (900_000 * E18);

        // 8. partial LP removal through the real pair (approve → burn)
        uint256 liqHalf = pair.balanceOf(address(this)) / 2;
        (removeOut0, removeOut1) = pair.removeLiquidity(liqHalf, 0, 0, address(this));
    }
}
