package com.demo.repository;

import com.demo.vo.OrderVO;

import java.util.List;
import java.util.Map;

@org.springframework.stereotype.Repository
public class DashboardRepository {

    public Map<String, Object> countOverview() {
        // SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM orders; SELECT SUM(amount) FROM orders
        return Map.of("userCount", 0, "orderCount", 0, "salesAmount", 0);
    }

    public List<Map<String, Object>> findTodos() {
        // SELECT '待发货订单' AS title, COUNT(*) AS count FROM orders WHERE status = 'PAID'
        // UNION ALL SELECT '库存预警', COUNT(*) FROM stock WHERE num < 10
        return List.of();
    }

    public List<OrderVO> findRecentOrders(int limit) {
        // SELECT * FROM orders WHERE deleted = 0 ORDER BY created_at DESC LIMIT ?
        return List.of();
    }
}
