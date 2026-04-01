require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const app = express();
const PORT = process.env.PORT || 3002;

// Swagger configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Station OTP Verification API',
            version: '1.0.0',
            description: 'API for verifying OTPs and completing fuel orders at stations',
            contact: {
                name: 'API Support'
            }
        },
        servers: [
            {
                url: `http://localhost:${PORT}`,
                description: 'Development server'
            }
        ]
    },
    apis: ['./src/server.js']
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Middleware
app.use(cors());
app.use(express.json());

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     description: Returns the health status of the service
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 service:
 *                   type: string
 *                   example: Station OTP Verification
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'Station OTP Verification' });
});

/**
 * @swagger
 * /verify-otp:
 *   post:
 *     summary: Verify OTP for a fuel order
 *     description: Validates the OTP and returns order details if valid
 *     tags: [OTP]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - otp
 *             properties:
 *               otp:
 *                 type: string
 *                 description: The 6-digit OTP code
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: OTP verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: OTP verified successfully
 *                 order:
 *                   type: object
 *                   properties:
 *                     order_id:
 *                       type: integer
 *                       example: 1
 *                     vehicle_reg:
 *                       type: string
 *                       example: "ABC 123"
 *                     vehicle:
 *                       type: string
 *                       example: "Toyota Hilux"
 *                     driver_name:
 *                       type: string
 *                       example: "John Doe"
 *                     driver_phone:
 *                       type: string
 *                       example: "+260971234567"
 *                     customer_name:
 *                       type: string
 *                       example: "Acme Corp"
 *                     fuel_type:
 *                       type: string
 *                       example: "diesel"
 *                     quantity:
 *                       type: number
 *                       example: 50
 *                     price_per_litre:
 *                       type: number
 *                       example: 25.50
 *                     total_amount:
 *                       type: number
 *                       example: 1275.00
 *       400:
 *         description: Bad request - OTP missing or expired
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: OTP is required
 *       404:
 *         description: Invalid OTP or order not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: Invalid OTP or order not found
 *       500:
 *         description: Server error
 */
app.post('/verify-otp', async (req, res) => {
    try {
        const { otp } = req.body;

        if (!otp) {
            return res.status(400).json({ 
                success: false, 
                error: 'OTP is required' 
            });
        }

        // Find order with matching OTP that hasn't expired
        const result = await pool.query(`
            SELECT 
                o.id as order_id,
                o.otp_code,
                o.otp_expires_at,
                o.status,
                o.fuel_grade as fuel_type,
                o.requested_fuel as quantity,
                v.registration_number as vehicle_reg,
                v.vehicle_type,
                d.name as driver_name,
                d.phone as driver_phone,
                c.name as customer_name
            FROM orders o
            JOIN vehicles v ON o.vehicle_id = v.id
            JOIN drivers d ON o.driver_id = d.id
            JOIN customers c ON o.customer_id = c.id
            WHERE o.otp_code = $1
            AND o.status = 'approved'
        `, [otp]);

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Invalid OTP or order not found' 
            });
        }

        const order = result.rows[0];

        // Check if OTP has expired
        if (order.otp_expires_at && new Date() > new Date(order.otp_expires_at)) {
            return res.status(400).json({ 
                success: false, 
                error: 'OTP has expired' 
            });
        }

        res.json({
            success: true,
            message: 'OTP verified successfully',
            order: {
                order_id: order.order_id,
                vehicle_reg: order.vehicle_reg,
                vehicle_type: order.vehicle_type,
                driver_name: order.driver_name,
                driver_phone: order.driver_phone,
                customer_name: order.customer_name,
                fuel_type: order.fuel_type,
                requested_fuel: order.quantity
            }
        });

    } catch (error) {
        console.error('OTP verification error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
});

/**
 * @swagger
 * /complete-order:
 *   post:
 *     summary: Complete a fuel order
 *     description: Marks the order as completed after fuel has been dispensed
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - otp
 *             properties:
 *               otp:
 *                 type: string
 *                 description: The OTP code for the order
 *                 example: "123456"
 *               litres_dispensed:
 *                 type: number
 *                 description: Actual litres dispensed (optional, defaults to order quantity)
 *                 example: 50
 *     responses:
 *       200:
 *         description: Order completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Order completed successfully
 *                 order_id:
 *                   type: integer
 *                   example: 1
 *                 litres_dispensed:
 *                   type: number
 *                   example: 50
 *       400:
 *         description: Bad request - OTP missing, expired, or order cannot be completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: OTP is required
 *       404:
 *         description: Order not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: Order not found
 *       500:
 *         description: Server error
 */
app.post('/complete-order', async (req, res) => {
    try {
        const { otp, litres_dispensed } = req.body;

        if (!otp) {
            return res.status(400).json({ 
                success: false, 
                error: 'OTP is required' 
            });
        }

        // Find the order
        const findResult = await pool.query(`
            SELECT id, requested_fuel as quantity, status, otp_expires_at
            FROM orders 
            WHERE otp_code = $1
        `, [otp]);

        if (findResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                error: 'Order not found' 
            });
        }

        const order = findResult.rows[0];

        if (order.status !== 'approved') {
            return res.status(400).json({ 
                success: false, 
                error: `Order cannot be completed. Current status: ${order.status}` 
            });
        }

        // Check if OTP has expired
        if (order.otp_expires_at && new Date() > new Date(order.otp_expires_at)) {
            return res.status(400).json({ 
                success: false, 
                error: 'OTP has expired' 
            });
        }

        // Update order to completed
        const actualLitres = litres_dispensed || order.quantity;
        
        await pool.query(`
            UPDATE orders 
            SET status = 'completed',
                otp_code = NULL,
                otp_expires_at = NULL,
                updated_at = NOW()
            WHERE id = $1
        `, [order.id]);

        res.json({
            success: true,
            message: 'Order completed successfully',
            order_id: order.id,
            litres_dispensed: actualLitres
        });

    } catch (error) {
        console.error('Complete order error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🔐 Station OTP Verification Server`);
    console.log(`   Running on http://localhost:${PORT}`);
    console.log(`\n   Endpoints:`);
    console.log(`   POST /verify-otp      - Verify OTP and get order details`);
    console.log(`   POST /complete-order  - Mark order as completed`);
    console.log(`\n   📚 Swagger Docs: http://localhost:${PORT}/api-docs\n`);
});
