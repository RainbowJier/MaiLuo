package com.demo.repository;

import com.demo.vo.ProductVO;
import org.springframework.data.domain.Page;

@org.springframework.stereotype.Repository
public class ProductRepository {

    public Page<ProductVO> findByPage(int page, int size, String keyword, Long categoryId) {
        // SELECT * FROM products WHERE deleted = 0 AND name LIKE ? AND category_id = ?
        return Page.empty();
    }

    public ProductVO findById(Long id) {
        // SELECT * FROM products WHERE id = ? AND deleted = 0
        return null;
    }

    public int countActiveOrders(Long productId) {
        // SELECT COUNT(*) FROM order_items WHERE product_id = ? AND status IN ('CREATED','PAID')
        return 0;
    }

    public int updateStatus(Long id, boolean onSale) {
        // UPDATE products SET on_sale = ? WHERE id = ?
        return 1;
    }

    public int markDeleted(Long id) {
        // UPDATE products SET deleted = 1 WHERE id = ?
        return 1;
    }
}
