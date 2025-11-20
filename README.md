# query-builder

The Dbcube Query Builder is a lightweight, flexible, and fluent library for building queries across multiple database engines, including MySQL, PostgreSQL, SQLite, and MongoDB, using JavaScript/Node.js.

Its agnostic design allows you to generate data manipulation (DML) and data definition (DDL) operations with a clean, chainable syntax—without sacrificing power or expressiveness.

It’s designed to work seamlessly in both SQL and NoSQL environments, providing a consistent abstraction layer across different storage technologies while still leveraging the native capabilities of each engine.

## Features

- **Fluent API** for building SQL queries
- **Type-safe** query construction
- **Support for SELECT, INSERT, UPDATE, DELETE**
- **Advanced WHERE conditions** (AND, OR, groups, BETWEEN, IN, NULL checks)
- **JOINs**: INNER, LEFT, RIGHT
- **Aggregations**: COUNT, SUM, AVG, MAX, MIN
- **Ordering, Grouping, Distinct, Pagination**
- **Column management** (future extension)
- **Promise-based asynchronous API**
- **Singleton connection management**

## Installation

```bash
npm install @dbcube/query-builder
```

## Quick Start

```typescript
import Database from "@dbcube/query-builder";

const db = new Database("my_database");

// Select all users
const users = await db.table("users").get();

// Select users with conditions
const activeUsers = await db
  .table("users")
  .where("status", "=", "active")
  .orderBy("created_at", "DESC")
  .limit(10)
  .get();

// Insert new users
await db
  .table("users")
  .insert([{ name: "John", email: "john@example.com", age: 30 }]);

// Update a user
await db.table("users").where("id", "=", 1).update({ status: "inactive" });

// Delete users
await db.table("users").where("status", "=", "deleted").delete();
```

## API Documentation

### Database

#### `new Database(name: string)`

Creates a new database connection instance.

#### `table(tableName: string): Table`

Returns a Table instance for building queries on the specified table.

### Table

#### Query Methods

- `select(fields?: string[])`: Specify columns to select.
- `where(column, operator, value)`: Add a WHERE condition.
- `orWhere(column, operator, value)`: Add an OR WHERE condition.
- `whereGroup(callback)`: Grouped WHERE conditions.
- `whereBetween(column, [min, max])`: WHERE BETWEEN condition.
- `whereIn(column, values)`: WHERE IN condition.
- `whereNull(column)`: WHERE IS NULL condition.
- `whereNotNull(column)`: WHERE IS NOT NULL condition.
- `join(table, column1, operator, column2)`: INNER JOIN.
- `leftJoin(table, column1, operator, column2)`: LEFT JOIN.
- `rightJoin(table, column1, operator, column2)`: RIGHT JOIN.
- `orderBy(column, direction)`: ORDER BY clause.
- `groupBy(column)`: GROUP BY clause.
- `distinct()`: DISTINCT clause.
- `count(column?)`: COUNT aggregation.
- `sum(column)`: SUM aggregation.
- `avg(column)`: AVG aggregation.
- `max(column)`: MAX aggregation.
- `min(column)`: MIN aggregation.
- `limit(number)`: LIMIT clause.
- `page(number)`: Pagination (requires limit).

#### Execution Methods

- `get()`: Execute and return all matching rows.
- `first()`: Execute and return the first matching row.
- `find(value, column?)`: Find a row by column value (default: id).
- `insert(data)`: Insert one or more rows.
- `update(data)`: Update rows matching the conditions.
- `delete()`: Delete rows matching the conditions.

## Example Usage

```typescript
// Complex query with joins, grouping, and aggregation
const results = await db
  .table("orders")
  .join("users", "orders.user_id", "=", "users.id")
  .where("orders.status", "=", "completed")
  .groupBy("users.country")
  .sum("orders.total")
  .orderBy("sum", "DESC")
  .limit(5)
  .get();
```

## Error Handling

All methods throw descriptive errors for invalid usage, such as missing WHERE conditions on update/delete, or invalid data types.

## License

This project is licensed under the MIT License.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## About

dbcube-query-builder is part of the dbcube ecosystem, designed to provide a robust and flexible query building experience for modern Node.js applications.
