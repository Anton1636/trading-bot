const { WebSocketProvider, Wallet, Contract } = require('ethers')
require('dotenv').config()
const blockchain = require('./blockchain.json')
const { Interface } = require('ethers')

const provider = new WebSocketProvider(process.env.MAINNET_RPC_URL_WS)
const wallet = Wallet.fromPhrase(process.env.MNEMONIC, provider)
const testTransactions = [
	'0xb8c4b4c59e1d76dc6f3fde3eca9d0455e5a13810baeec094e91998ccdf058254',
	'0x3a57505c123915d028e26cec19bc3c2ffc759def64459598bcd55e97a3b2e9f8',
]
const contractInteface = new Interface(blockchain.swapRouter02Abi)
const TRADE_SIZE = 1000 //in USDT
const SLIPPAGE = 0.01

const proccessTransaction = async txHash => {
	console.log(`Recieved tx: ${txHash}`)

	const tx = await provider.getTransaction(txHash)

	if (tx.to === blockchain.swapRouter82Address) {
		const decodedData = contractInteface.parseTransaction({ data: tx.data })
		if (
			decodedData &&
			decodedData.name === 'exactInputSingle' &&
			decodedData.data.args.params[0] === blockchain.wethAddress
		) {
			console.log('Found a candidate t for frontrunning')
			const params = decodedData.args.params
			const tokenIn = params[0]
			const tokenOut = params[1]
			const fee = params[2]
			const amountIn = params[4]
			const amountOut = params[5]
			const sqrtPriceLimitX96 = params[6]
			console.log(' Original parameters: ')
			console.log(`Token Sold: ${tokenIn}`)
			console.log(`Token Bought: ${tokenOut}`)
			console.log(`Amount In: ${amountIn.toString()}`)
			console.log(`Amount Out: ${amountOut.toString()}`)
			console.log(`Sqrt Price Limit: ${sqrtPriceLimitX96.toString()}`)

			const quoter = new Contract(
				blockchain.quoterV2Address,
				blockchain.quoterV2Abi,
				provider
			)
			const factory = new Contract(
				blockchain.factoryAddress,
				blockchain.factoryAbi,
				provider
			)
			const poolAddress = await factory.getPool(tokenIn, tokenOut, fee)
			const pool = new Contract(poolAddress, blockchain.poolAbi, provider)
			const simulationParams = {
				tokenIn,
				tokenOut,
				fee,
				amountIn,
				sqrtPriceLimitX96,
			}

			const [slot0, qoute] = await Promise.all([
				pool.slot0(),
				quoter.quoterExactInputSingle.staticCall(simulationParams),
			])
			const sqrtPriceX96After = qoute[1]
			const { sqrtPriceX96 } = slot0
			const priceImpact = Math.abs(
				Number((10000n * sqrtPriceX96After) / sqrtPriceX96) / 10000 - 1
			)

			console.log(`Price Impact: ${priceImpact}`)

			const gasLimit = parseInt(tx.gasLimit)
			const gasPrice = tx.gasPrice
			const result = fetch(
				`https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&x_cg_demo_api_key=${process.env.NEXT_PUBLIC_COINGEKO_API_KEY}`
			)
			const resultJson = await result.json()
			const etherPrice = NUmber(resultJson.ethereum.usd)
			const txCost = (NUmber(gasLimit * gasPrice) * etherPrice) / 10 ** 18
			const minPriceImpact = 2 * (txCost / TRADE_SIZE + SLIPPAGE)

			if (priceImpact >= minPriceImpact) {
				const newAmountin = (10 ** 18 * TRADE_SIZE) / etherPrice
				const newAmountOutIn = (1 - SLIPPAGE) * newAmountin
				const router = new Contract(
					blockchain.swapRouter82Address,
					blockchain.swapRouter02Abi,
					wallet
				)
				const tx = await router.swapExactinput(
					{
						tokenIn,
						tokenOut,
						fee,
						amountIn: newAmountin,
						amountOutMinimum: newAmountOutIn,
						sqrtPriceLimitX96: 0,
					},
					{
						gasPrice: gasPrice + 1,
					}
				)

				const receipt = await tx.wait()

				if (receipt.status == '0x1') {
					console.log(`Frontrun transaction was mined & successful: ${tx.hash}`)
				} else {
					console.log(
						`Frontrun transaction was mined & NOT successful: ${tx.hash}`
					)
				}
			}
		}
	}
}

const testRun = async () => {
	for (const txHash of testTransactions) {
		proccessTransaction(txHash)
	}
}

const testTxPreSecond = () => {
	console.log(`starting ${Date.now()}`)

	let txCount = 0

	provider.on('pending', tx => {
		txCount += 1
		console.log(`Last recorder txCount: ${txCount}`)
		console.log(`Last recorder time: ${Date.now()}`)
	})
}

const init = async () => {
	provider.on('pending', tx => {
		proccessTransaction(tx)
	})
}

const timeout = ms => {
	return new Promise(resolve => setTimeout(resolve, ms))
}

const main = async () => {
	init()
	while (true) {
		console.log('Heartbeat')
		await timeout(1000)
	}
}

main()
