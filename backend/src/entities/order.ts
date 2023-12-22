import { Entity, PrimaryGeneratedColumn } from "typeorm"

@Entity()
export class Order {
  @PrimaryGeneratedColumn('increment')
  id: number
}
