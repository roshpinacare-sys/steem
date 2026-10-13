#!/usr/bin/env python3
"""
Marker Flow Journal - Engine-measured health and failure reason journaling
Prevents unclassified failures from poisoning the failure histogram
"""

class MarkerFlowJournal:
    """
    Tracks engine-measured health metrics and failure reasons with classification status.
    Unclassified failures are quarantined, not recorded in the main histogram.
    """
    
    def __init__(self):
        self.classified_failures = []
        self.quarantined_failures = []
        self.health_metrics = {}
    
    def record_failure(self, failure_data, classification=None):
        """
        Record a failure with optional classification.
        Unclassified failures are quarantined.
        """
        if classification is None:
            self.quarantined_failures.append(failure_data)
        else:
            failure_data['classification'] = classification
            self.classified_failures.append(failure_data)
    
    def record_health_metric(self, metric_name, value, timestamp=None):
        """
        Record engine-measured health metrics.
        """
        if timestamp is None:
            timestamp = time.time()
        
        if metric_name not in self.health_metrics:
            self.health_metrics[metric_name] = []
        
        self.health_metrics[metric_name].append({
            'value': value,
            'timestamp': timestamp
        })
    
    def get_classification_stats(self):
        """
        Get statistics about failure classifications.
        """
        stats = {
            'total_classified': len(self.classified_failures),
            'total_quarantined': len(self.quarantined_failures),
            'classifications': {}
        }
        
        for failure in self.classified_failures:
            classification = failure.get('classification', 'unknown')
            if classification not in stats['classifications']:
                stats['classifications'][classification] = 0
            stats['classifications'][classification] += 1
        
        return stats
    
    def quarantine_to_classify(self, failure_data):
        """
        Move a quarantined failure to classified failures after classification.
        """
        if failure_data in self.quarantined_failures:
            self.quarantined_failures.remove(failure_data)
            self.record_failure(failure_data, classification=failure_data.get('classification'))

if __name__ == '__main__':
    import time
    
    # Example usage
    journal = MarkerFlowJournal()
    
    # Record a classified failure
    journal.record_failure({
        'reason': 'timeout',
        'severity': 'medium',
        'component': 'network'
    }, classification='network_timeout')
    
    # Record an unclassified failure
    journal.record_failure({
        'reason': 'unexpected_error',
        'severity': 'high',
        'component': 'unknown'
    })
    
    # Record health metrics
    journal.record_health_metric('cpu_usage', 45.2)
    journal.record_health_metric('memory_usage', 78.5)
    
    # Print statistics
    print("Classification Statistics:")
    print(journal.get_classification_stats())
