// Destructive reset of this isolated demo only. Stop API, dispatcher and worker first.
import {pool,redis,connect,broker,STOCK} from '../backend/common.js';
import {INITIAL_STOCK} from '../backend/domain.js';
if (!process.argv.includes('--confirm-reset')) throw new Error('Pass --confirm-reset to delete all demo orders and reservations. Stop API/dispatcher/worker first.');
await connect();const {connection,channel}=await broker();
for(const queue of ['checkout','checkout.retry','checkout.failed'])await channel.purgeQueue(queue);
const client=await pool.connect();
try{
  await client.query('BEGIN');
  await client.query('TRUNCATE orders, attempts');
  await client.query('UPDATE inventory SET stock=initial_stock');
  await client.query('UPDATE system_state SET admission_initialized=true');
  await client.query('COMMIT');
}catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
await redis.flushDb();await redis.set(STOCK,String(INITIAL_STOCK));
console.log('Reset isolated demo: 500 available, zero orders, empty queues. Evidence files retained.');
// common.js treats unexpected broker close as fatal; intentional close exits here.
connection.removeAllListeners('close');await connection.close();await redis.quit();await pool.end();
