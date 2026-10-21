# x402 Quote Guard — free offline GitHub Action

**Confirm that a public unsigned x402 v2 PAYMENT-REQUIRED quote still names Base, the official Circle Base USDC contract, your actual receiving wallet, and the exact price, before a buyer authorizes a transaction.**

AI-assisted original MIT-licensed work from [VM5 Delivery Lab](https://livastic-vm5-primary-20260911.github.io/vm5-delivery-lab/). All validation happens **offline**. No fetch, tracker, wallet, private key, payment signing, smart-contract interaction or paid settlement. A passing result cannot establish that a merchant delivered the paid response, that a buyer paid, or that a transaction finalized.

### Use in a GitHub Actions workflow

Add this to a public or private repository after saving a public unsigned v2 HTTP 402 quote to a workspace file:

~~~yaml
name: Base x402 quote regression
on: [push, pull_request]
permissions:
  contents: read
jobs:
  quote:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: livastic-vm5-primary-20260911/x402-checkout-guard-action@v1
        with:
          quote_file: fixtures/public-quote.json
          expected_payto: "0x6b01efA0705E91a7aca54271510bf9e594717f34"
          price_usdc: "0.005"
          expected_url: "https://vm5-openapi-x402.onrender.com/v1/csv-report"
~~~

**Change the recipient, price, quote_file and optional URL to YOUR product.** This example is the actual original VM5 merchant, not a promise that every merchant is safe. The action accepts JSON or a base64 PAYMENT-REQUIRED header string. It refuses wrong networks, lookalike tokens, changed payee, price drift, malformed quote, wrong resource URL and duplicate conflicting Base offers.

### Test in a local shell

~~~bash
node src/check.mjs --file fixtures/valid-vm5-csv-quote.json \
 --recipient 0x6b01efA0705E91a7aca54271510bf9e594717f34 \
 --price 0.005 \
 --url https://vm5-openapi-x402.onrender.com/v1/csv-report
node --test test/*.test.mjs
~~~

The included fixture came from a genuine **unsigned** live HTTP 402 of VM5's original public merchant. No wallet was used to obtain it. The sample is dated and not an uptime SLA.

### Value and limitations

- This catches silent misconfiguration of the intended payee, token, price, network and resource URL *before* any buyer spends tokens.
- The tool never stores or prints raw quote payloads, headers, wallet signatures, customer CSVs, credentials or secrets.
- It checks exactly x402 v2, Base mainnet (eip155:8453) and native official Circle USDC contract 0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913. No misleading equivalence to Polygon, Base Sepolia, other USDC variants or x402 v1.
- A valid unsigned HTTP402 quote is not independently verified settlement or paid-service delivery. Merchants should still run explicit buyer-authorized end-to-end tests under their own limits.

### Need paid manual assistance?

The GitHub Action is **free**. The separately operated VM5 original [19 native Base USDC fixed developer QA listing](https://clawlancer.ai/marketplace/a06039e5-cab4-4f8c-ae16-03a2c713abd9) is an optional different scope and subject to its platform's checkout and terms. Customers can alternatively use our [private scope inquiry](https://docs.google.com/forms/d/e/1FAIpQLSe_N8anCGUDmWdNZLnGwFRfhYaaCsB18BKdYd_VsFZp1xWm3g/viewform) without payment. Only authorized synthetic/public data and an independently agreed quote can start a paid review. Neither this README nor source is evidence of sales.

For a separate originally operating 0.005 Circle Base USDC paid CSV quality report, [CommaCheck Base free preview and optional buyer checkout](https://livastic-vm5-primary-20260911.github.io/base-usdc-csv-checkout/) is available. The [one-time public merchant status snapshot](https://livastic-vm5-primary-20260911.github.io/vm5-delivery-lab/merchant-status/) is unsigned, dated and not a receipt.

### CI permissions

The source owner GitHub OAuth permission does not currently include the additional workflow write scope. The independently passing offline test pipeline is preserved in [examples/ci-workflow-not-activated.yml](examples/ci-workflow-not-activated.yml) as a **non-executing template**, not falsely represented as a GitHub-hosted successful CI run. The action itself is published and can be used from another workflow already managed by a repository owner with appropriate permissions. Only an authorized human may enable the example in GitHub Actions.

### License

MIT; original AI-assisted code. No safety certification or warranty of payment finality.
