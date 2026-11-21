package com.demo.repository;

import com.demo.dto.OrderDTO;
import com.demo.vo.OrderVO;
import org.apache.ibatis.annotations.*;
import org.springframework.data.domain.Page;

@org.springframework.stereotype.Repository
public class OrderRepository {

    public Page<OrderVO> findByUser(int page, int size, String keyword) {
        // SELECT * FROM orders WHERE user_id = ? AND deleted = 0
        return Page.empty();
    }

    public Long insert(OrderDTO dto) {
        // INSERT INTO orders (sku_id, quantity, amount, address, remark) VALUES (...)
        return 1L;
    }

    public int updateWithVersion(Long id, OrderDTO dto) {
        // UPDATE orders SET address=?, remark=? WHERE id=? AND version=?
        return 1;
    }

    public int markDeleted(Long id) {
        // UPDATE orders SET deleted = 1 WHERE id = ?
        return 1;
    }

    public int markItemsDeleted(Long orderId) {
        // UPDATE order_items SET deleted = 1 WHERE order_id = ?
        return 1;
    }
}
