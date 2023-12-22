import express, { Request, Response } from "express";
import cors from "cors";
import { Signer } from "@aws-sdk/rds-signer";
import { DataSource } from 'typeorm';
import { Order } from './entities/order';
const app = express();

const DB_HOST = process.env.DB_HOST!;
const DB_PORT = parseInt(process.env.DB_PORT!);
const DB_DATABASE = process.env.DB_DATABASE!;
const DB_USERNAME = process.env.DB_USERNAME!;
const DB_ACCESS_TYPE = process.env.DB_ACCESS_TYPE || 'iam';
const DB_PASSWORD = process.env.DB_PASSWORD;

const createDBConnection = async (): Promise<DataSource> => {
  const rdssigner = new Signer({
    hostname: DB_HOST,
    port: DB_PORT,
    username: DB_USERNAME,
  });

  return new DataSource({
    type: 'postgres',
    host: DB_HOST,
    port: DB_PORT,
    database: DB_DATABASE,
    username: DB_USERNAME,
    password: DB_ACCESS_TYPE === 'iam' ? async () => {
      return await rdssigner.getAuthToken();
    } : DB_PASSWORD!,
    entities: [Order],
    synchronize: true,
    logging: false,
  });
};

async function main() {
  console.log("Connected to RDS");

  const db = await createDBConnection()
  await db.initialize()

  app.use(cors());

  app.get("/orders", async (req: Request, res: Response) => {
    const orders = await db.manager.find(Order)
    res.send(orders);
  });

  app.delete("/orders/:id", async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    await db.manager.delete(Order, id)
    res.send("ok");
  });

  app.post("/orders", async (req: Request, res: Response) => {
    db.manager.save(new Order())
    res.send("ok");
  });

  app.listen(3000, () => {
    console.log(`Assignment app listening at :3000`);
  });
}

main()
  .then(() => console.log("server started"))
  .catch((err) => console.error(err));
