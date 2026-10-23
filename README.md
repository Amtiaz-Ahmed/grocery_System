# 🛒 Grocery Store Management System

## 📌 Overview

The **Grocery Store Management System** is a local Windows app for managing grocery inventory, sales, and reports from a dashboard.

Built with **Node.js**, **Express.js**, and **MySQL**, the system provides a reliable and responsive interface, ensuring a smooth user experience on desktops, tablets, and smartphones.

---

## 🚀 Features

- 📦 **Inventory Management**
  - Add, update, delete products
  - Real-time stock tracking

- 💰 **Sales Processing**
  - Handle purchases and transactions
  - Auto-generate receipts
  - Manage multiple payment methods

- 📊 **Reporting Dashboard**
  - Review sales, orders, and products sold by day, week, or month
  - See new-product stock entries and restock activity for the selected period
  - Compare product sales with current stock and low-stock thresholds
  - Monitor low-stock items
  - Review inventory stock changes

- 📱 **Responsive UI**
  - Mobile-friendly design
  - Clean and intuitive interface

---

## 🧰 Tech Stack

| Category        | Technology          |
|----------------|---------------------|
| Frontend       | HTML, CSS, JavaScript |
| Backend        | Node.js, Express.js |
| Database       | MySQL               |
| DB Management  | PHPMyAdmin          |
| Package Manager| npm                 |
| Version Control| Git & GitHub        |

---

## ⚙️ Installation Guide

For a Windows client laptop:

1. Install XAMPP and Node.js LTS.
2. Start MySQL in XAMPP. In phpMyAdmin, import [`client_grocery_dump.sql`](./dbms%20project/client_grocery_dump.sql) to create the database with its current application data. Use [`grocery_schema.sql`](./dbms%20project/grocery_schema.sql) only if you want an empty database; create/select that database first and do not import both.
3. Copy [`dbms project/.env.example`](./dbms%20project/.env.example) to `dbms project\.env` and adjust the database settings if the XAMPP MySQL account is not the default.
4. Double-click [`Start Grocery System.bat`](./dbms%20project/Start%20Grocery%20System.bat). On the first run it installs Node packages and needs internet access; then it opens the dashboard.

For daily use, start MySQL in XAMPP and click the launcher. The dashboard has no login and is bound to `127.0.0.1`, so it is intended for this laptop only.

## Automatic reports and database backups

When the server starts, it creates any missing daily sales CSVs and monthly sales CSVs, then saves a database SQL backup. It checks every minute and saves one database backup per calendar day. Files are saved under `Desktop\GroceryBackups` in the Windows account running the server, with sales reports in `DailySales` and `MonthlySales`, and SQL backups in `Database`.

The schedule follows the computer's local time; set the client's Windows time zone to Asia/Karachi for midnight Pakistan time. The server must be running for jobs to run at midnight. If the computer is off, completed sales reports are generated after the server starts again; a current database backup is also made at startup. Keep another copy of `GroceryBackups` on an external drive or remote storage if you need protection from laptop loss or disk failure. A backup stored only on the laptop cannot protect against failure of that laptop.

---

## 🧪 Usage

- 📁 **Inventory**: Add, update, and delete grocery products.
- 🧾 **Sales**: Record transactions and view receipts.
- 📉 **Reports**: Monitor key business metrics.

---

## 📂 Folder Structure

```
Grocery-Store-Management-System/
├── dbms project/
│   ├── public/             # Dashboard page, styles, and browser script
│   ├── index_admin.js      # Local Node.js server
│   ├── client_grocery_dump.sql
│   ├── grocery_schema.sql
│   └── Start Grocery System.bat
└── README.md
```

---

## 👨‍💻 Author

**Geetansh Mohindru**  
📫 [Email](mailto:geetanshmohindru@gmail.com)  
🌐 [LinkedIn](https://www.linkedin.com/in/geetansh-mohindru/) 

---


## 💡 Future Enhancements

- 📦 Barcode scanner integration
- 🛍️ Customer loyalty points system
- 📱 PWA support for offline access
- 🔔 Low-stock alert notifications

---

If you like this project, feel free to ⭐ the repository!
