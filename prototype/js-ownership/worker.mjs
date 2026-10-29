import { parentPort, workerData } from 'node:worker_threads';
import { Arena } from './arena.mjs';
import { wrap } from './struct.mjs';
import { sumTree } from './model.mjs';

const MAIN_THREAD_ID = 0;
const arena = new Arena(workerData.buffer);

const handlers = {
    ack: () => null,
    take: ({ regionId }) => arena.region(regionId).check(),
    giveBack: ({ regionId }) => arena.region(regionId).moveTo(MAIN_THREAD_ID),
    sumAndGiveBack: ({ regionId, root }) => {
        const region = arena.region(regionId);
        const sum = sumTree(wrap(region, root));
        region.moveTo(MAIN_THREAD_ID);
        return sum;
    },
};

parentPort.on('message', (message) => {
    try {
        parentPort.postMessage({ value: handlers[message.type](message) });
    } catch (error) {
        parentPort.postMessage({ error: `${error.name}: ${error.message}` });
    }
});
